import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Html, Line, OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';

import earthCloudsUrl from '../assets/earth/earth_clouds.png';
import earthDayUrl from '../assets/earth/earth_day.jpg';
import earthNormalUrl from '../assets/earth/earth_normal.jpg';
import earthSpecularUrl from '../assets/earth/earth_specular.jpg';
import yunnanBoundary from '../assets/yunnan/yunnan-boundary.json';
import countyBoundary from '../assets/yunnan/yunnan-counties.json';
import prefectureBoundary from '../assets/yunnan/yunnan-prefectures.json';

const TIANDITU_KEY = '17a12b18fab1455d1a9dedbfed384eca';
const TILE_SUBDOMAINS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];
const TILE_ZOOM = 8;
const TEXTURE_SIZE = 1280;
const RELIEF_TEXTURE_SIZE = 512;
const DEM_TILE_SIZE = 128;
const MAX_CACHE_ITEMS = 10;
const PROVINCE_BOUNDS = {
  west: 97.35,
  east: 106.35,
  south: 20.95,
  north: 29.45,
};

type DrillView = 'earth' | 'province' | 'prefecture' | 'county';
type LngLat = [number, number];
type Bounds = {
  west: number;
  east: number;
  south: number;
  north: number;
};
type BoundaryGeometry = {
  type: 'MultiPolygon';
  coordinates: LngLat[][][];
};
type BoundaryFeature = {
  type: 'Feature';
  properties: {
    adcode: number;
    name: string;
    center: LngLat;
    centroid?: LngLat;
    parentAdcode?: number;
    parentName?: string;
  };
  geometry: BoundaryGeometry;
};
type RegionConfig = {
  id: string;
  name: string;
  center: LngLat;
  bounds: Bounds;
  polygons: LngLat[][][];
  markers: RegionMarker[];
  mapWidth: number;
  mapHeight: number;
};
type RegionMarker = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  level: number;
};

type PrefectureInfo = {
  id: string;
  name: string;
  shortName: string;
  center: LngLat;
  bounds: Bounds;
  polygons: LngLat[][][];
};

type CountyInfo = PrefectureInfo & {
  parentId: string;
};

type MercatorBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
type ElevationSampler = {
  source: 'dem' | 'fallback';
  minMeters: number;
  maxMeters: number;
  getMeters: (u: number, v: number) => number;
  getHeight: (u: number, v: number) => number;
};
type RegionCacheEntry = {
  elevationPromise?: Promise<ElevationSampler>;
  elevation?: ElevationSampler;
  texturePromise?: Promise<THREE.Texture>;
  texture?: THREE.Texture;
  terrainGeometry?: THREE.BufferGeometry;
  wallGeometry?: THREE.BufferGeometry;
};

const provinceFeature = yunnanBoundary.features[0] as unknown as BoundaryFeature;
const provincePolygons = provinceFeature.geometry.coordinates;
const prefectureFeatures = prefectureBoundary.features as unknown as BoundaryFeature[];
const countyFeatures = countyBoundary.features as unknown as BoundaryFeature[];
const prefectures = prefectureFeatures.map((feature) => {
  const bounds = boundsFromPolygons(feature.geometry.coordinates, 0.18);
  return {
    id: String(feature.properties.adcode),
    name: feature.properties.name,
    shortName: shortRegionName(feature.properties.name),
    center: feature.properties.center,
    bounds,
    polygons: feature.geometry.coordinates,
  };
});
const counties = countyFeatures.map((feature) => {
  const bounds = boundsFromPolygons(feature.geometry.coordinates, 0.08);
  return {
    id: String(feature.properties.adcode),
    parentId: String(feature.properties.parentAdcode),
    name: feature.properties.name,
    shortName: shortRegionName(feature.properties.name),
    center: feature.properties.center,
    bounds,
    polygons: feature.geometry.coordinates,
  };
});

const yunnanCenter = provinceFeature.properties.center;
const yunnanRegion: RegionConfig = {
  id: '530000',
  name: '云南省',
  center: yunnanCenter,
  bounds: PROVINCE_BOUNDS,
  polygons: provincePolygons,
  markers: prefectures.map((prefecture) => ({
    id: prefecture.id,
    name: prefecture.shortName,
    lng: prefecture.center[0],
    lat: prefecture.center[1],
    level: prefecture.id === '530100' ? 1 : 2,
  })),
  mapWidth: 8.6,
  mapHeight: 7.7,
};
const regionCache = new Map<string, RegionCacheEntry>();
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function getRegionCache(regionId: string) {
  let entry = regionCache.get(regionId);

  if (!entry) {
    entry = {};
    regionCache.set(regionId, entry);
  }

  if (regionCache.size > MAX_CACHE_ITEMS) {
    const firstKey = regionCache.keys().next().value as string | undefined;
    if (firstKey && firstKey !== regionId) {
      const stale = regionCache.get(firstKey);
      stale?.texture?.dispose();
      stale?.terrainGeometry?.dispose();
      stale?.wallGeometry?.dispose();
      regionCache.delete(firstKey);
    }
  }

  return entry;
}

function shortRegionName(name: string) {
  return name
    .replace('傣族景颇族自治州', '')
    .replace('哈尼族彝族自治州', '')
    .replace('壮族苗族自治州', '')
    .replace('傣族自治州', '')
    .replace('白族自治州', '')
    .replace('彝族自治州', '')
    .replace('傈僳族自治州', '')
    .replace('藏族自治州', '')
    .replace('市', '');
}

function boundsFromPolygons(polygons: LngLat[][][], padding = 0.1): Bounds {
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach(([lng, lat]) => {
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      });
    });
  });

  return {
    west: west - padding,
    east: east + padding,
    south: south - padding,
    north: north + padding,
  };
}

function buildPrefectureRegion(prefecture: PrefectureInfo): RegionConfig {
  const lngSpan = prefecture.bounds.east - prefecture.bounds.west;
  const latSpan = prefecture.bounds.north - prefecture.bounds.south;
  const width = 7.8;
  const height = THREE.MathUtils.clamp(width * (latSpan / Math.max(lngSpan, 0.1)), 4.4, 7.8);
  const childCounties = counties.filter((county) => county.parentId === prefecture.id);

  return {
    id: prefecture.id,
    name: prefecture.name,
    center: prefecture.center,
    bounds: prefecture.bounds,
    polygons: prefecture.polygons,
    markers: childCounties.map((county) => ({
      id: county.id,
      name: county.shortName,
      lng: county.center[0],
      lat: county.center[1],
      level: 2,
    })),
    mapWidth: width,
    mapHeight: height,
  };
}

function buildCountyRegion(county: CountyInfo): RegionConfig {
  const lngSpan = county.bounds.east - county.bounds.west;
  const latSpan = county.bounds.north - county.bounds.south;
  const width = 7.2;
  const height = THREE.MathUtils.clamp(width * (latSpan / Math.max(lngSpan, 0.1)), 4.1, 7.2);

  return {
    id: county.id,
    name: county.name,
    center: county.center,
    bounds: county.bounds,
    polygons: county.polygons,
    markers: [{
      id: county.id,
      name: county.shortName,
      lng: county.center[0],
      lat: county.center[1],
      level: 1,
    }],
    mapWidth: width,
    mapHeight: height,
  };
}

function mercatorX(lng: number) {
  return (lng + 180) / 360;
}

function mercatorY(lat: number) {
  const rad = THREE.MathUtils.degToRad(lat);
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

function mercatorBoundsFromBounds(bounds: Bounds): MercatorBounds {
  return {
    minX: mercatorX(bounds.west),
    maxX: mercatorX(bounds.east),
    minY: mercatorY(bounds.north),
    maxY: mercatorY(bounds.south),
  };
}

function createProjection(region: RegionConfig) {
  const mercatorBounds = mercatorBoundsFromBounds(region.bounds);

  const lngLatToUv = (lng: number, lat: number) => {
    const u = (mercatorX(lng) - mercatorBounds.minX) / (mercatorBounds.maxX - mercatorBounds.minX);
    const v = (mercatorY(lat) - mercatorBounds.minY) / (mercatorBounds.maxY - mercatorBounds.minY);
    return { u, v };
  };

  const lngLatToScene = (lng: number, lat: number, lift = 0) => {
    const { u, v } = lngLatToUv(lng, lat);
    const x = (u - 0.5) * region.mapWidth;
    const z = (v - 0.5) * region.mapHeight;
    return new THREE.Vector3(x, terrainHeight(u, v, region.id) + lift, z);
  };

  return { mercatorBounds, lngLatToScene, lngLatToUv };
}

function createSceneProjector(region: RegionConfig, elevation: ElevationSampler) {
  const projection = createProjection(region);
  const lngLatToScene = (lng: number, lat: number, lift = 0) => {
    const { u, v } = projection.lngLatToUv(lng, lat);
    const x = (u - 0.5) * region.mapWidth;
    const z = (v - 0.5) * region.mapHeight;
    return new THREE.Vector3(x, elevation.getHeight(u, v) + lift, z);
  };

  return { ...projection, lngLatToScene };
}

function tileUrl(layer: 'img' | 'cia', tx: number, ty: number, zoom: number) {
  const sub = TILE_SUBDOMAINS[(tx + ty) % TILE_SUBDOMAINS.length];
  return `https://${sub}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${zoom}&TILEROW=${ty}&TILECOL=${tx}&tk=${TIANDITU_KEY}`;
}

function demTileUrl(tx: number, ty: number, zoom: number) {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
}

function loadImage(url: string) {
  const cached = imageCache.get(url);
  if (cached) return cached;

  const request = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

  imageCache.set(url, request);
  return request;
}

function tileIndexFromMercator(value: number, zoom: number) {
  return Math.floor(value * 2 ** zoom);
}

function drawBoundaryPath(ctx: CanvasRenderingContext2D, region: RegionConfig) {
  const { lngLatToUv } = createProjection(region);
  const path = new Path2D();

  region.polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach(([lng, lat], index) => {
        const { u, v } = lngLatToUv(lng, lat);
        const x = u * TEXTURE_SIZE;
        const y = v * TEXTURE_SIZE;

        if (index === 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      });
      path.closePath();
    });
  });

  ctx.fill(path, 'evenodd');
}

function drawBoundaryStroke(ctx: CanvasRenderingContext2D, region: RegionConfig) {
  const { lngLatToUv } = createProjection(region);

  region.polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      ctx.beginPath();
      ring.forEach(([lng, lat], index) => {
        const { u, v } = lngLatToUv(lng, lat);
        const x = u * TEXTURE_SIZE;
        const y = v * TEXTURE_SIZE;

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.stroke();
    });
  });
}

async function drawTiandituLayer(ctx: CanvasRenderingContext2D, region: RegionConfig, layer: 'img' | 'cia') {
  const { mercatorBounds } = createProjection(region);
  const tiles = 2 ** TILE_ZOOM;
  const minTileX = tileIndexFromMercator(mercatorBounds.minX, TILE_ZOOM);
  const maxTileX = tileIndexFromMercator(mercatorBounds.maxX, TILE_ZOOM);
  const minTileY = tileIndexFromMercator(mercatorBounds.minY, TILE_ZOOM);
  const maxTileY = tileIndexFromMercator(mercatorBounds.maxY, TILE_ZOOM);
  const spanX = mercatorBounds.maxX - mercatorBounds.minX;
  const spanY = mercatorBounds.maxY - mercatorBounds.minY;
  const requests: Promise<void>[] = [];

  for (let ty = minTileY; ty <= maxTileY; ty += 1) {
    for (let tx = minTileX; tx <= maxTileX; tx += 1) {
      const request = loadImage(tileUrl(layer, tx, ty, TILE_ZOOM))
        .then((img) => {
          const tileLeft = tx / tiles;
          const tileTop = ty / tiles;
          const dx = ((tileLeft - mercatorBounds.minX) / spanX) * TEXTURE_SIZE;
          const dy = ((tileTop - mercatorBounds.minY) / spanY) * TEXTURE_SIZE;
          const dw = (1 / tiles / spanX) * TEXTURE_SIZE;
          const dh = (1 / tiles / spanY) * TEXTURE_SIZE;
          ctx.globalAlpha = layer === 'cia' ? 0.82 : 1;
          ctx.drawImage(img, dx - 1, dy - 1, dw + 2, dh + 2);
          ctx.globalAlpha = 1;
        })
        .catch(() => undefined);

      requests.push(request);
    }
  }

  await Promise.all(requests);
}

function decodeTerrariumElevation(r: number, g: number, b: number) {
  return r * 256 + g + b / 256 - 32768;
}

function sampleBilinear(values: Float32Array, width: number, height: number, u: number, v: number) {
  const x = THREE.MathUtils.clamp(u, 0, 1) * (width - 1);
  const y = THREE.MathUtils.clamp(v, 0, 1) * (height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = values[y0 * width + x0];
  const b = values[y0 * width + x1];
  const c = values[y1 * width + x0];
  const d = values[y1 * width + x1];
  const ab = THREE.MathUtils.lerp(a, b, tx);
  const cd = THREE.MathUtils.lerp(c, d, tx);

  return THREE.MathUtils.lerp(ab, cd, ty);
}

function createFallbackElevationSampler(region: RegionConfig): ElevationSampler {
  return {
    source: 'fallback',
    minMeters: 0,
    maxMeters: 3200,
    getMeters: (u, v) => terrainSample(u, v, region.id) * 4200,
    getHeight: (u, v) => terrainSample(u, v, region.id),
  };
}

async function buildElevationSampler(region: RegionConfig): Promise<ElevationSampler> {
  const zoom = region.id === '530000' ? 7 : counties.some((county) => county.id === region.id) ? 9 : 8;
  const { mercatorBounds } = createProjection(region);
  const tiles = 2 ** zoom;
  const minTileX = tileIndexFromMercator(mercatorBounds.minX, zoom);
  const maxTileX = tileIndexFromMercator(mercatorBounds.maxX, zoom);
  const minTileY = tileIndexFromMercator(mercatorBounds.minY, zoom);
  const maxTileY = tileIndexFromMercator(mercatorBounds.maxY, zoom);
  const tileCols = maxTileX - minTileX + 1;
  const tileRows = maxTileY - minTileY + 1;
  const gridWidth = tileCols * DEM_TILE_SIZE;
  const gridHeight = tileRows * DEM_TILE_SIZE;
  const grid = new Float32Array(gridWidth * gridHeight);
  grid.fill(Number.NaN);
  const requests: Promise<void>[] = [];

  for (let ty = minTileY; ty <= maxTileY; ty += 1) {
    for (let tx = minTileX; tx <= maxTileX; tx += 1) {
      const request = loadImage(demTileUrl(tx, ty, zoom))
        .then((img) => {
          const tileCanvas = document.createElement('canvas');
          tileCanvas.width = DEM_TILE_SIZE;
          tileCanvas.height = DEM_TILE_SIZE;
          const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true })!;
          tileCtx.drawImage(img, 0, 0, DEM_TILE_SIZE, DEM_TILE_SIZE);
          const data = tileCtx.getImageData(0, 0, DEM_TILE_SIZE, DEM_TILE_SIZE).data;
          const offsetX = (tx - minTileX) * DEM_TILE_SIZE;
          const offsetY = (ty - minTileY) * DEM_TILE_SIZE;

          for (let py = 0; py < DEM_TILE_SIZE; py += 1) {
            for (let px = 0; px < DEM_TILE_SIZE; px += 1) {
              const sourceIndex = (py * DEM_TILE_SIZE + px) * 4;
              const targetIndex = (offsetY + py) * gridWidth + offsetX + px;
              grid[targetIndex] = decodeTerrariumElevation(data[sourceIndex], data[sourceIndex + 1], data[sourceIndex + 2]);
            }
          }
        })
        .catch(() => undefined);

      requests.push(request);
    }
  }

  await Promise.all(requests);

  let minMeters = Number.POSITIVE_INFINITY;
  let maxMeters = Number.NEGATIVE_INFINITY;
  let validCount = 0;

  for (const meters of grid) {
    if (Number.isFinite(meters)) {
      minMeters = Math.min(minMeters, meters);
      maxMeters = Math.max(maxMeters, meters);
      validCount += 1;
    }
  }

  if (!validCount || maxMeters - minMeters < 10) {
    return createFallbackElevationSampler(region);
  }

  const spanX = mercatorBounds.maxX - mercatorBounds.minX;
  const spanY = mercatorBounds.maxY - mercatorBounds.minY;
  const normalizeFactor = region.id === '530000' ? 1.08 : counties.some((county) => county.id === region.id) ? 1.48 : 1.28;

  const getMeters = (u: number, v: number) => {
    const mercatorU = mercatorBounds.minX + u * spanX;
    const mercatorV = mercatorBounds.minY + v * spanY;
    const globalPixelX = mercatorU * tiles * DEM_TILE_SIZE;
    const globalPixelY = mercatorV * tiles * DEM_TILE_SIZE;
    const localX = (globalPixelX - minTileX * DEM_TILE_SIZE) / (gridWidth - 1);
    const localY = (globalPixelY - minTileY * DEM_TILE_SIZE) / (gridHeight - 1);
    return sampleBilinear(grid, gridWidth, gridHeight, localX, localY);
  };

  return {
    source: 'dem',
    minMeters,
    maxMeters,
    getMeters,
    getHeight: (u, v) => {
      const meters = getMeters(u, v);
      const normalized = (meters - minMeters) / Math.max(1, maxMeters - minMeters);
      const shaped = Math.pow(THREE.MathUtils.clamp(normalized, 0, 1), 0.9);
      return 0.025 + shaped * normalizeFactor;
    },
  };
}

function drawFallbackRelief(ctx: CanvasRenderingContext2D, regionId: string) {
  const gradient = ctx.createLinearGradient(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  gradient.addColorStop(0, '#4d6d5b');
  gradient.addColorStop(0.3, '#6f875a');
  gradient.addColorStop(0.55, '#455f46');
  gradient.addColorStop(0.78, '#234d50');
  gradient.addColorStop(1, '#1e3b46');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  const seed = Number(regionId.slice(-3)) || 17;
  for (let i = 0; i < 34; i += 1) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255,255,255,${0.04 + (i % 4) * 0.015})`;
    ctx.lineWidth = 2;
    const y = (i / 34) * TEXTURE_SIZE;
    ctx.moveTo(0, y + Math.sin(i + seed) * 18);
    ctx.bezierCurveTo(
      TEXTURE_SIZE * 0.25,
      y - 120 + Math.cos(i + seed) * 60,
      TEXTURE_SIZE * 0.7,
      y + 130,
      TEXTURE_SIZE,
      y + Math.sin(i * 1.7 + seed) * 90,
    );
    ctx.stroke();
  }
}

function fract(value: number) {
  return value - Math.floor(value);
}

function smooth(value: number) {
  return value * value * (3 - 2 * value);
}

function hash2(x: number, y: number, seed: number) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123);
}

function valueNoise(u: number, v: number, scale: number, seed: number) {
  const x = u * scale;
  const y = v * scale;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = smooth(x - x0);
  const yf = smooth(y - y0);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  const nx0 = THREE.MathUtils.lerp(n00, n10, xf);
  const nx1 = THREE.MathUtils.lerp(n01, n11, xf);
  return THREE.MathUtils.lerp(nx0, nx1, yf);
}

function fbm(u: number, v: number, seed: number) {
  let value = 0;
  let amplitude = 0.5;
  let scale = 2.8;

  for (let i = 0; i < 5; i += 1) {
    value += valueNoise(u, v, scale, seed + i * 11.7) * amplitude;
    scale *= 2.05;
    amplitude *= 0.52;
  }

  return value;
}

function rotatedCoords(u: number, v: number, angle: number) {
  const x = u - 0.5;
  const y = v - 0.5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

function regionSeed(regionId: string) {
  return (Number(regionId.slice(-3)) || 31) / 100;
}

function regionReliefScale(regionId: string) {
  if (regionId === '530000') return 0.92;
  if (counties.some((county) => county.id === regionId)) return 1.42;
  return 1.18;
}

function ravineMask(u: number, v: number, regionId: string) {
  const seed = regionSeed(regionId);
  const primary = rotatedCoords(u, v, -0.74 + seed * 0.22);
  const secondary = rotatedCoords(u, v, 0.42 - seed * 0.16);
  const flowNoise = fbm(u * 1.25 + seed, v * 1.25 - seed, seed + 4.4) - 0.5;
  const primaryWave = Math.sin((primary.x * 18.5 + primary.y * 4.2 + flowNoise * 1.8 + seed) * Math.PI);
  const secondaryWave = Math.sin((secondary.x * 28 + secondary.y * 9.5 - flowNoise * 2.2) * Math.PI);
  const trunk = Math.pow(1 - Math.abs(primaryWave), 8.5);
  const branch = Math.pow(1 - Math.abs(secondaryWave), 10);
  const valleyGate = 0.45 + valueNoise(u, v, 5.4, seed + 8.1) * 0.55;

  return THREE.MathUtils.clamp(trunk * 0.85 + branch * 0.46 * valleyGate, 0, 1);
}

function terrainSample(u: number, v: number, regionId: string) {
  const seed = regionSeed(regionId);
  const reliefScale = regionReliefScale(regionId);
  const primary = rotatedCoords(u, v, -0.7 + seed * 0.18);
  const cross = rotatedCoords(u, v, 0.28 - seed * 0.12);
  const macroNoise = fbm(u + seed, v - seed, seed);
  const fineNoise = fbm(u * 2.3 - seed, v * 2.3 + seed, seed + 18.6);
  const foldA = Math.pow(1 - Math.abs(Math.sin((primary.x * 10.5 + primary.y * 2.3 + macroNoise * 1.1) * Math.PI)), 2.4);
  const foldB = Math.pow(1 - Math.abs(Math.sin((cross.x * 16 + cross.y * 5.2 + fineNoise * 1.25) * Math.PI)), 3.2);
  const westHigh = Math.pow(1 - u, 1.35) * 0.34;
  const northRidge = Math.exp(-((u - 0.22) ** 2 / 0.035 + (v - 0.28) ** 2 / 0.08)) * 0.22;
  const centralFold = Math.exp(-((u - 0.48) ** 2 / 0.12 + (v - 0.52) ** 2 / 0.035)) * 0.12;
  const southValley = Math.exp(-((u - 0.6) ** 2 / 0.2 + (v - 0.86) ** 2 / 0.04)) * -0.12;
  const gullies = ravineMask(u, v, regionId);
  const relief = (
    0.04
    + westHigh
    + northRidge
    + centralFold
    + foldA * 0.15
    + foldB * 0.08
    + macroNoise * 0.08
    + fineNoise * 0.035
    + southValley
    - gullies * 0.16
  ) * reliefScale;

  return Math.max(0.012, relief);
}

function drawTerrainShading(ctx: CanvasRenderingContext2D, region: RegionConfig, elevation: ElevationSampler) {
  const shadeCanvas = document.createElement('canvas');
  shadeCanvas.width = RELIEF_TEXTURE_SIZE;
  shadeCanvas.height = RELIEF_TEXTURE_SIZE;
  const shadeCtx = shadeCanvas.getContext('2d')!;
  const shadow = shadeCtx.createImageData(RELIEF_TEXTURE_SIZE, RELIEF_TEXTURE_SIZE);
  const highlightCanvas = document.createElement('canvas');
  highlightCanvas.width = RELIEF_TEXTURE_SIZE;
  highlightCanvas.height = RELIEF_TEXTURE_SIZE;
  const highlightCtx = highlightCanvas.getContext('2d')!;
  const highlight = highlightCtx.createImageData(RELIEF_TEXTURE_SIZE, RELIEF_TEXTURE_SIZE);
  const lineCanvas = document.createElement('canvas');
  lineCanvas.width = RELIEF_TEXTURE_SIZE;
  lineCanvas.height = RELIEF_TEXTURE_SIZE;
  const lineCtx = lineCanvas.getContext('2d')!;
  const lines = lineCtx.createImageData(RELIEF_TEXTURE_SIZE, RELIEF_TEXTURE_SIZE);
  const du = 1 / RELIEF_TEXTURE_SIZE;
  const dv = 1 / RELIEF_TEXTURE_SIZE;
  const light = new THREE.Vector3(-0.48, 0.76, -0.42).normalize();

  for (let y = 0; y < RELIEF_TEXTURE_SIZE; y += 1) {
    const v = (y + 0.5) / RELIEF_TEXTURE_SIZE;
    for (let x = 0; x < RELIEF_TEXTURE_SIZE; x += 1) {
      const u = (x + 0.5) / RELIEF_TEXTURE_SIZE;
      const hL = elevation.getHeight(Math.max(0, u - du), v);
      const hR = elevation.getHeight(Math.min(1, u + du), v);
      const hU = elevation.getHeight(u, Math.max(0, v - dv));
      const hD = elevation.getHeight(u, Math.min(1, v + dv));
      const h = elevation.getHeight(u, v);
      const dx = (hR - hL) * 9.8;
      const dz = (hD - hU) * 9.8;
      const normal = new THREE.Vector3(-dx, 1, -dz).normalize();
      const shade = THREE.MathUtils.clamp(normal.dot(light), -1, 1);
      const slope = THREE.MathUtils.clamp(Math.sqrt(dx * dx + dz * dz) * 0.85, 0, 1);
      const ravine = elevation.source === 'dem'
        ? THREE.MathUtils.clamp(Math.max(0, -((hR - hL) + (hD - hU)) * 3.2) + slope * 0.38, 0, 1)
        : ravineMask(u, v, region.id);
      const dataIndex = (y * RELIEF_TEXTURE_SIZE + x) * 4;
      const shadowAlpha = THREE.MathUtils.clamp((0.48 - shade) * 120 + ravine * 92 + slope * 34, 0, 160);
      const highlightAlpha = THREE.MathUtils.clamp((shade - 0.42) * 92 + slope * 24, 0, 105);
      const contour = Math.abs(fract(h * 19) - 0.5);
      const contourAlpha = contour < 0.024 ? (1 - contour / 0.024) * 46 : 0;

      shadow.data[dataIndex] = 6;
      shadow.data[dataIndex + 1] = 16;
      shadow.data[dataIndex + 2] = 18;
      shadow.data[dataIndex + 3] = shadowAlpha;
      highlight.data[dataIndex] = 244;
      highlight.data[dataIndex + 1] = 255;
      highlight.data[dataIndex + 2] = 218;
      highlight.data[dataIndex + 3] = highlightAlpha;
      lines.data[dataIndex] = 210;
      lines.data[dataIndex + 1] = 250;
      lines.data[dataIndex + 2] = 230;
      lines.data[dataIndex + 3] = contourAlpha;
    }
  }

  shadeCtx.putImageData(shadow, 0, 0);
  highlightCtx.putImageData(highlight, 0, 0);
  lineCtx.putImageData(lines, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.96;
  ctx.drawImage(shadeCanvas, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.72;
  ctx.drawImage(highlightCanvas, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.44;
  ctx.drawImage(lineCanvas, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx.restore();
}

async function buildRegionTexture(region: RegionConfig, elevation: ElevationSampler) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d')!;

  drawFallbackRelief(ctx, region.id);
  await drawTiandituLayer(ctx, region, 'img');
  drawTerrainShading(ctx, region, elevation);
  await drawTiandituLayer(ctx, region, 'cia');

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#000';
  drawBoundaryPath(ctx, region);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(152, 235, 255, 0.9)';
  ctx.lineWidth = region.id === '530000' ? 5 : 7;
  drawBoundaryStroke(ctx, region);
  ctx.strokeStyle = 'rgba(60, 216, 255, 0.32)';
  ctx.lineWidth = region.id === '530000' ? 16 : 22;
  drawBoundaryStroke(ctx, region);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function terrainHeight(u: number, v: number, regionId: string) {
  return terrainSample(u, v, regionId);
}

function createTerrainGeometry(region: RegionConfig, elevation: ElevationSampler) {
  const segmentsX = region.id === '530000' ? 120 : counties.some((county) => county.id === region.id) ? 150 : 136;
  const segmentsZ = Math.max(140, Math.round(segmentsX * (region.mapHeight / region.mapWidth)));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= segmentsZ; j += 1) {
    const v = j / segmentsZ;
    for (let i = 0; i <= segmentsX; i += 1) {
      const u = i / segmentsX;
      const x = (u - 0.5) * region.mapWidth;
      const z = (v - 0.5) * region.mapHeight;
      positions.push(x, elevation.getHeight(u, v), z);
      uvs.push(u, 1 - v);
    }
  }

  for (let j = 0; j < segmentsZ; j += 1) {
    for (let i = 0; i < segmentsX; i += 1) {
      const a = j * (segmentsX + 1) + i;
      const b = a + 1;
      const c = a + (segmentsX + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createBoundaryWallGeometry(region: RegionConfig, elevation: ElevationSampler) {
  const { lngLatToScene } = createSceneProjector(region, elevation);
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexIndex = 0;

  region.polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      for (let i = 0; i < ring.length - 1; i += 1) {
        const current = lngLatToScene(ring[i][0], ring[i][1], 0.012);
        const next = lngLatToScene(ring[i + 1][0], ring[i + 1][1], 0.012);
        const bottomCurrent = current.clone();
        const bottomNext = next.clone();
        bottomCurrent.y = -0.24;
        bottomNext.y = -0.24;

        positions.push(
          current.x, current.y, current.z,
          next.x, next.y, next.z,
          bottomNext.x, bottomNext.y, bottomNext.z,
          bottomCurrent.x, bottomCurrent.y, bottomCurrent.z,
        );
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;
      }
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function useRegionElevation(region: RegionConfig) {
  const [elevation, setElevation] = useState<ElevationSampler | null>(() => getRegionCache(region.id).elevation ?? null);

  useEffect(() => {
    let disposed = false;
    const entry = getRegionCache(region.id);

    if (entry.elevation) {
      setElevation(entry.elevation);
      return () => {
        disposed = true;
      };
    }

    if (!entry.elevationPromise) {
      entry.elevationPromise = buildElevationSampler(region).then((nextElevation) => {
        entry.elevation = nextElevation;
        return nextElevation;
      });
    }

    setElevation(null);
    entry.elevationPromise.then((nextElevation) => {
      if (!disposed) {
        setElevation(nextElevation);
      }
    });

    return () => {
      disposed = true;
    };
  }, [region]);

  return elevation;
}

function useRegionTexture(region: RegionConfig, elevation: ElevationSampler | null) {
  const [texture, setTexture] = useState<THREE.Texture | null>(() => getRegionCache(region.id).texture ?? null);

  useEffect(() => {
    if (!elevation) {
      setTexture(null);
      return undefined;
    }

    let disposed = false;
    const entry = getRegionCache(region.id);

    if (entry.texture) {
      setTexture(entry.texture);
      return () => {
        disposed = true;
      };
    }

    if (!entry.texturePromise) {
      entry.texturePromise = buildRegionTexture(region, elevation).then((nextTexture) => {
        entry.texture = nextTexture;
        return nextTexture;
      });
    }

    setTexture(null);
    entry.texturePromise.then((nextTexture) => {
      if (disposed) {
        return;
      }

      setTexture(nextTexture);
    });

    return () => {
      disposed = true;
    };
  }, [elevation, region]);

  return texture;
}

function BoundaryLines({ elevation, region }: { elevation: ElevationSampler; region: RegionConfig }) {
  const { lngLatToScene } = useMemo(() => createSceneProjector(region, elevation), [elevation, region]);
  const lines = useMemo(() => (
    region.polygons.flatMap((polygon) => (
      polygon.map((ring) => ring.map(([lng, lat]) => lngLatToScene(lng, lat, 0.036)))
    ))
  ), [lngLatToScene, region]);

  return (
    <>
      {lines.map((points, index) => (
        <Line
          key={`boundary-${region.id}-${index}`}
          points={points}
          color="#a5f3ff"
          transparent
          opacity={0.95}
          lineWidth={region.id === '530000' ? 1.4 : 1.8}
        />
      ))}
    </>
  );
}

function ChildBoundaryLines({ elevation, region }: { elevation: ElevationSampler; region: RegionConfig }) {
  const { lngLatToScene } = useMemo(() => createSceneProjector(region, elevation), [elevation, region]);
  const lines = useMemo(() => {
    if (region.id === '530000') {
      return prefectures.flatMap((prefecture) => (
        prefecture.polygons.flatMap((polygon) => (
          polygon.map((ring) => ring.map(([lng, lat]) => lngLatToScene(lng, lat, 0.052)))
        ))
      ));
    }

    const childCounties = counties.filter((county) => county.parentId === region.id);
    return childCounties.flatMap((county) => (
      county.polygons.flatMap((polygon) => (
        polygon.map((ring) => ring.map(([lng, lat]) => lngLatToScene(lng, lat, 0.052)))
      ))
    ));
  }, [lngLatToScene, region.id]);

  return (
    <>
      {lines.map((points, index) => (
        <Line
          key={`child-line-${region.id}-${index}`}
          points={points}
          color="#d7fbff"
          transparent
          opacity={region.id === '530000' ? 0.34 : 0.38}
          lineWidth={region.id === '530000' ? 0.8 : 0.72}
        />
      ))}
    </>
  );
}

function GridOverlay({ elevation, region }: { elevation: ElevationSampler; region: RegionConfig }) {
  const { lngLatToScene } = useMemo(() => createSceneProjector(region, elevation), [elevation, region]);
  const gridLines = useMemo(() => {
    const lines: THREE.Vector3[][] = [];
    const lngStep = region.id === '530000' ? 1 : 0.35;
    const latStep = region.id === '530000' ? 1 : 0.35;
    const sampleStep = region.id === '530000' ? 0.16 : 0.06;

    for (let lng = Math.ceil(region.bounds.west); lng <= region.bounds.east; lng += lngStep) {
      const points: THREE.Vector3[] = [];
      for (let lat = region.bounds.south; lat <= region.bounds.north; lat += sampleStep) {
        points.push(lngLatToScene(lng, lat, 0.018));
      }
      lines.push(points);
    }

    for (let lat = Math.ceil(region.bounds.south); lat <= region.bounds.north; lat += latStep) {
      const points: THREE.Vector3[] = [];
      for (let lng = region.bounds.west; lng <= region.bounds.east; lng += sampleStep) {
        points.push(lngLatToScene(lng, lat, 0.018));
      }
      lines.push(points);
    }

    return lines;
  }, [lngLatToScene, region]);

  return (
    <>
      {gridLines.map((points, index) => (
        <Line
          key={`grid-${region.id}-${index}`}
          points={points}
          color="#6ae8ff"
          transparent
          opacity={0.14}
          lineWidth={0.5}
        />
      ))}
    </>
  );
}

function RegionMarker({
  marker,
  elevation,
  region,
  onSelect,
}: {
  elevation: ElevationSampler;
  marker: RegionMarker;
  region: RegionConfig;
  onSelect?: (id: string) => void;
}) {
  const { lngLatToScene } = useMemo(() => createSceneProjector(region, elevation), [elevation, region]);
  const point = useMemo(() => lngLatToScene(marker.lng, marker.lat, 0.09), [lngLatToScene, marker.lat, marker.lng]);
  const markerSize = marker.level === 1 ? 0.07 : 0.052;

  return (
    <group position={point} onClick={(event) => {
      event.stopPropagation();
      onSelect?.(marker.id);
    }}>
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[markerSize, 20, 20]} />
        <meshBasicMaterial color={marker.level === 1 ? '#ffd45a' : '#4ff3ff'} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[0.1, 0.11, 56]} />
        <meshBasicMaterial color="#8ff5ff" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <Html className="city-label" center distanceFactor={8} position={[0.12, 0.18, 0]}>
        <button type="button" onClick={() => onSelect?.(marker.id)}>{marker.name}</button>
      </Html>
    </group>
  );
}

function TerrainModel({
  region,
  onMarkerSelect,
}: {
  region: RegionConfig;
  onMarkerSelect?: (id: string) => void;
}) {
  const elevation = useRegionElevation(region);
  const texture = useRegionTexture(region, elevation);
  const fallbackElevation = useMemo(() => createFallbackElevationSampler(region), [region]);
  const activeElevation = elevation ?? fallbackElevation;
  const terrainGeometry = useMemo(() => {
    const entry = getRegionCache(region.id);
    if (elevation && entry.terrainGeometry) return entry.terrainGeometry;
    const geometry = createTerrainGeometry(region, activeElevation);
    if (elevation) entry.terrainGeometry = geometry;
    return geometry;
  }, [activeElevation, elevation, region]);
  const wallGeometry = useMemo(() => {
    const entry = getRegionCache(region.id);
    if (elevation && entry.wallGeometry) return entry.wallGeometry;
    const geometry = createBoundaryWallGeometry(region, activeElevation);
    if (elevation) entry.wallGeometry = geometry;
    return geometry;
  }, [activeElevation, elevation, region]);

  useEffect(() => () => {
    if (!elevation) {
      terrainGeometry.dispose();
      wallGeometry.dispose();
    }
  }, [elevation, terrainGeometry, wallGeometry]);

  return (
    <group>
      <mesh geometry={terrainGeometry} receiveShadow>
        <meshStandardMaterial
          map={texture ?? undefined}
          color={texture ? '#ffffff' : '#4a6656'}
          roughness={0.78}
          metalness={0.02}
          transparent
          alphaTest={0.04}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh geometry={wallGeometry}>
        <meshStandardMaterial
          color="#1688a7"
          emissive="#0a526f"
          emissiveIntensity={0.35}
          roughness={0.64}
          transparent
          opacity={0.48}
          side={THREE.DoubleSide}
        />
      </mesh>

      <BoundaryLines elevation={activeElevation} region={region} />
      <ChildBoundaryLines elevation={activeElevation} region={region} />
      <GridOverlay elevation={activeElevation} region={region} />
      {region.markers.map((marker) => (
        <RegionMarker
          key={marker.id}
          elevation={activeElevation}
          marker={marker}
          region={region}
          onSelect={onMarkerSelect}
        />
      ))}
      <Html className="terrain-source" position={[-region.mapWidth / 2, 0.36, -region.mapHeight / 2]}>
        <span>{elevation?.source === 'dem' ? `DEM ${Math.round(elevation.minMeters)}-${Math.round(elevation.maxMeters)}m` : 'DEM 加载中'}</span>
      </Html>
    </group>
  );
}

function LoadingTerrain({ region }: { region: RegionConfig }) {
  const elevation = useMemo(() => createFallbackElevationSampler(region), [region]);
  const geometry = useMemo(() => createTerrainGeometry(region, elevation), [elevation, region]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#355d54" roughness={0.86} wireframe />
    </mesh>
  );
}

function latLngToVec3(lat: number, lng: number, radius: number) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lng + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function EarthModel({ onYunnanSelect }: { onYunnanSelect: () => void }) {
  const earthRef = useRef<THREE.Group>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);
  const hotspotRef = useRef<THREE.Group>(null);
  const [day, normal, specular, clouds] = useLoader(THREE.TextureLoader, [
    earthDayUrl,
    earthNormalUrl,
    earthSpecularUrl,
    earthCloudsUrl,
  ]);

  useMemo(() => {
    [day, normal, specular, clouds].forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
    });
    normal.colorSpace = THREE.NoColorSpace;
    specular.colorSpace = THREE.NoColorSpace;
  }, [clouds, day, normal, specular]);

  const hotspot = useMemo(() => latLngToVec3(yunnanCenter[1], yunnanCenter[0], 1.04), []);

  useFrame(({ clock }) => {
    const elapsed = clock.elapsedTime;
    if (earthRef.current) {
      earthRef.current.rotation.y = THREE.MathUtils.degToRad(-126) + elapsed * 0.035;
      earthRef.current.rotation.x = THREE.MathUtils.degToRad(-23.4);
      earthRef.current.rotation.z = THREE.MathUtils.degToRad(5);
    }

    if (cloudsRef.current) {
      cloudsRef.current.rotation.y = elapsed * 0.052;
    }

    if (hotspotRef.current) {
      const scale = 1 + Math.sin(elapsed * 2.6) * 0.12;
      hotspotRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group rotation={[0.1, -0.52, -0.08]}>
      <group ref={earthRef}>
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[1, 160, 160]} />
          <meshPhongMaterial
            map={day}
            normalMap={normal}
            normalScale={new THREE.Vector2(0.42, 0.42)}
            specularMap={specular}
            specular={new THREE.Color('#31475c')}
            shininess={9}
          />
        </mesh>
        <mesh ref={cloudsRef}>
          <sphereGeometry args={[1.014, 128, 128]} />
          <meshPhongMaterial map={clouds} transparent opacity={0.32} depthWrite={false} shininess={4} />
        </mesh>
        <mesh>
          <sphereGeometry args={[1.025, 96, 96]} />
          <meshBasicMaterial color="#5edcff" transparent opacity={0.045} side={THREE.BackSide} />
        </mesh>
        <group ref={hotspotRef} position={hotspot} onClick={(event) => {
          event.stopPropagation();
          onYunnanSelect();
        }}>
          <mesh>
            <sphereGeometry args={[0.028, 18, 18]} />
            <meshBasicMaterial color="#ffd45a" />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.06, 24, 24]} />
            <meshBasicMaterial color="#33e8ff" transparent opacity={0.22} depthWrite={false} />
          </mesh>
          <Html className="earth-hotspot" center distanceFactor={7} position={[0.12, 0.08, 0]}>
            <button type="button" onClick={onYunnanSelect}>云南</button>
          </Html>
        </group>
      </group>
    </group>
  );
}

function GlobeScene({ onYunnanSelect }: { onYunnanSelect: () => void }) {
  return (
    <Canvas
      camera={{ position: [0, 0.06, 3.25], fov: 38, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, background: 'transparent' }}
    >
      <color attach="background" args={['#02070e']} />
      <fog attach="fog" args={['#02070e', 5.8, 13]} />
      <ambientLight intensity={1.26} />
      <hemisphereLight args={['#ffffff', '#84b8ff', 1.05]} />
      <directionalLight position={[2.4, 2.2, 5]} intensity={2.15} color="#fff8ea" />
      <directionalLight position={[-4, -0.8, -2.5]} intensity={1.2} color="#8fc9ff" />
      <pointLight position={[0, 0.8, 3.2]} intensity={1.25} color="#ffffff" distance={5} />
      <Stars radius={56} depth={28} count={1600} factor={2.8} saturation={0} fade speed={0.28} />
      <Suspense fallback={null}>
        <EarthModel onYunnanSelect={onYunnanSelect} />
      </Suspense>
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        autoRotate
        autoRotateSpeed={0.14}
        minDistance={2.15}
        maxDistance={4.8}
        enablePan={false}
      />
    </Canvas>
  );
}

function TerrainScene({
  region,
  onMarkerSelect,
}: {
  region: RegionConfig;
  onMarkerSelect?: (id: string) => void;
}) {
  const cameraY = region.id === '530000' ? 5.4 : 4.9;
  const cameraZ = region.id === '530000' ? 6.6 : 6.1;

  return (
    <Canvas
      camera={{ position: [0, cameraY, cameraZ], fov: 43, near: 0.1, far: 100 }}
      gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
      frameloop="demand"
      style={{ position: 'absolute', inset: 0, background: 'transparent' }}
    >
      <color attach="background" args={['#031018']} />
      <fog attach="fog" args={['#031018', 8.5, 18]} />
      <ambientLight intensity={0.92} />
      <hemisphereLight args={['#ecffff', '#10212b', 1.15]} />
      <directionalLight position={[3.5, 5.2, 4.8]} intensity={2.1} color="#fff6df" />
      <directionalLight position={[-4.5, 2.5, -3]} intensity={0.8} color="#62d9ff" />
      <Suspense fallback={<LoadingTerrain region={region} />}>
        <TerrainModel region={region} onMarkerSelect={onMarkerSelect} />
      </Suspense>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, 0.18, 0]}
        minDistance={3.8}
        maxDistance={11}
        minPolarAngle={0.46}
        maxPolarAngle={1.22}
        enablePan
      />
    </Canvas>
  );
}

export default function YunnanGisMap() {
  const [view, setView] = useState<DrillView>('earth');
  const [selectedPrefectureId, setSelectedPrefectureId] = useState<string | null>(null);
  const [selectedCountyId, setSelectedCountyId] = useState<string | null>(null);
  const selectedPrefecture = useMemo(
    () => prefectures.find((prefecture) => prefecture.id === selectedPrefectureId) ?? prefectures[0],
    [selectedPrefectureId],
  );
  const selectedCounty = useMemo(
    () => counties.find((county) => county.id === selectedCountyId) ?? counties.find((county) => county.parentId === selectedPrefecture.id) ?? counties[0],
    [selectedCountyId, selectedPrefecture.id],
  );
  const currentRegion = view === 'county'
    ? buildCountyRegion(selectedCounty)
    : view === 'prefecture'
      ? buildPrefectureRegion(selectedPrefecture)
      : yunnanRegion;
  const childList = view === 'province'
    ? prefectures.map((prefecture) => ({ id: prefecture.id, name: prefecture.shortName }))
    : view === 'prefecture'
      ? counties
        .filter((county) => county.parentId === selectedPrefecture.id)
        .map((county) => ({ id: county.id, name: county.shortName }))
      : [];

  const openProvince = useCallback(() => {
    setSelectedPrefectureId(null);
    setSelectedCountyId(null);
    setView('province');
  }, []);

  const openPrefecture = useCallback((id: string) => {
    setSelectedPrefectureId(id);
    setSelectedCountyId(null);
    setView('prefecture');
  }, []);

  const openCounty = useCallback((id: string) => {
    setSelectedCountyId(id);
    setView('county');
  }, []);

  return (
    <section className="gis-map" aria-label="地球到云南省州县 3D GIS 下钻地图">
      <div className="gis-map__hud">
        <strong>{view === 'earth' ? '地球 GIS 总览' : currentRegion.name}</strong>
        <span>
          {view === 'earth'
            ? '点击地球上的云南进入省级 3D 地形'
            : view === 'province'
              ? '点击州/市标注进入对应 3D 地形'
              : view === 'prefecture'
                ? '点击县/区/市标注进入县级 3D 地形'
                : '天地图影像 · 县级地形模型'}
        </span>
      </div>

      <div className="gis-map__nav" aria-label="地图层级导航">
        <button type="button" className={view === 'earth' ? 'is-active' : ''} onClick={() => setView('earth')}>
          地球
        </button>
        <button type="button" className={view === 'province' ? 'is-active' : ''} onClick={openProvince}>
          云南
        </button>
        {view === 'prefecture' ? (
          <button type="button" className="is-active">
            {selectedPrefecture.shortName}
          </button>
        ) : null}
        {view === 'county' ? (
          <>
            <button type="button" onClick={() => setView('prefecture')}>
              {selectedPrefecture.shortName}
            </button>
            <button type="button" className="is-active">
              {selectedCounty.shortName}
            </button>
          </>
        ) : null}
      </div>

      {childList.length > 0 ? (
        <div className="gis-map__children" aria-label="下级行政区列表">
          <span>{view === 'province' ? '州/市' : '县/区/市'}</span>
          <div>
            {childList.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => (view === 'province' ? openPrefecture(item.id) : openCounty(item.id))}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {view === 'earth' ? (
        <GlobeScene onYunnanSelect={openProvince} />
      ) : (
        <TerrainScene
          region={currentRegion}
          onMarkerSelect={view === 'province' ? openPrefecture : view === 'prefecture' ? openCounty : undefined}
        />
      )}
    </section>
  );
}
