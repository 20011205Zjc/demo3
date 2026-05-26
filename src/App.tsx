import { useEffect, useState, type ReactNode } from 'react';
import { channelShare, cityFlow, eventList, hourlyTrend, kpis, nodes } from './data';

function useNow() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

function StatCard({ item, index }: { item: (typeof kpis)[number]; index: number }) {
  return (
    <article className={`stat-card stat-card--${item.tone}`} style={{ animationDelay: `${index * 90}ms` }}>
      <span>{item.label}</span>
      <strong>{item.value}</strong>
      <em>{item.delta} 较昨日</em>
    </article>
  );
}

function Panel({
  title,
  eyebrow,
  children,
  className = '',
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel__head">
        <div>
          {eyebrow ? <span>{eyebrow}</span> : null}
          <h2>{title}</h2>
        </div>
        <i />
      </div>
      {children}
    </section>
  );
}

function BarRanking() {
  return (
    <div className="ranking">
      {cityFlow.map((item, index) => (
        <div className="ranking__row" key={item.city} style={{ animationDelay: `${index * 70}ms` }}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <b>{item.city}</b>
          <div>
            <i style={{ width: `${item.value}%` }} />
          </div>
          <em>{item.value}%</em>
        </div>
      ))}
    </div>
  );
}

function TrendChart() {
  const width = 420;
  const height = 180;
  const max = Math.max(...hourlyTrend);
  const points = hourlyTrend
    .map((value, index) => {
      const x = (index / (hourlyTrend.length - 1)) * width;
      const y = height - (value / max) * 145 - 18;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="trend">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="小时交易趋势折线图">
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#19d6ff" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#19d6ff" stopOpacity="0" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[35, 75, 115, 155].map((y) => (
          <line className="trend__grid" key={y} x1="0" x2={width} y1={y} y2={y} />
        ))}
        <polygon className="trend__area" points={`0,${height} ${points} ${width},${height}`} />
        <polyline className="trend__line" points={points} filter="url(#glow)" />
        {hourlyTrend.map((value, index) => {
          const x = (index / (hourlyTrend.length - 1)) * width;
          const y = height - (value / max) * 145 - 18;
          return <circle className="trend__dot" key={`${value}-${index}`} cx={x} cy={y} r="3.8" />;
        })}
      </svg>
    </div>
  );
}

function DonutChart() {
  let offset = 25;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label="渠道占比环形图">
        <circle className="donut__track" cx="60" cy="60" r={radius} />
        {channelShare.map((item) => {
          const dash = (item.value / 100) * circumference;
          const segment = (
            <circle
              className="donut__segment"
              cx="60"
              cy="60"
              key={item.name}
              r={radius}
              stroke={item.color}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={offset}
            />
          );
          offset -= dash;
          return segment;
        })}
        <text x="60" y="57">
          84.6M
        </text>
        <text x="60" y="73">
          GMV
        </text>
      </svg>
      <div className="donut__legend">
        {channelShare.map((item) => (
          <p key={item.name}>
            <i style={{ background: item.color }} />
            <span>{item.name}</span>
            <b>{item.value}%</b>
          </p>
        ))}
      </div>
    </div>
  );
}

function NetworkMap() {
  const lines = [
    [nodes[0], nodes[1]],
    [nodes[1], nodes[2]],
    [nodes[2], nodes[3]],
    [nodes[3], nodes[4]],
    [nodes[4], nodes[0]],
    [nodes[4], nodes[1]],
  ];

  return (
    <div className="network">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {lines.map(([from, to]) => (
          <line key={`${from.name}-${to.name}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
        ))}
      </svg>
      {nodes.map((node) => (
        <button
          className="network__node"
          key={node.name}
          style={{
            left: `${node.x}%`,
            top: `${node.y}%`,
            animationDelay: `${node.pulse}s`,
          }}
        >
          <span />
          <b>{node.name}</b>
        </button>
      ))}
      <div className="network__core">
        <span>实时调度</span>
        <strong>98.7%</strong>
      </div>
    </div>
  );
}

function EventFeed() {
  return (
    <div className="events">
      {eventList.map((item) => (
        <article className={`event event--${item.level}`} key={`${item.title}-${item.time}`}>
          <span>{item.level}</span>
          <div>
            <strong>{item.title}</strong>
            <small>{item.time}</small>
          </div>
          <em>{item.status}</em>
        </article>
      ))}
    </div>
  );
}

export default function App() {
  const now = useNow();
  const dateText = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(now);
  const timeText = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);

  return (
    <main className="screen">
      <div className="screen__halo screen__halo--one" />
      <div className="screen__halo screen__halo--two" />
      <header className="hero">
        <div>
          <span className="hero__eyebrow">Operation Intelligence Center</span>
          <h1>智慧运营数据大屏</h1>
        </div>
        <div className="hero__time">
          <strong>{timeText}</strong>
          <span>{dateText}</span>
        </div>
      </header>

      <section className="stats">
        {kpis.map((item, index) => (
          <StatCard item={item} index={index} key={item.label} />
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-grid__left">
          <Panel eyebrow="Regional Load" title="城市热力排行">
            <BarRanking />
          </Panel>
          <Panel eyebrow="Channel Mix" title="渠道贡献结构">
            <DonutChart />
          </Panel>
        </div>

        <Panel eyebrow="Live Mesh" title="全国节点态势" className="panel--center">
          <NetworkMap />
        </Panel>

        <div className="dashboard-grid__right">
          <Panel eyebrow="GMV Trend" title="小时交易趋势">
            <TrendChart />
          </Panel>
          <Panel eyebrow="Event Stream" title="实时事件流">
            <EventFeed />
          </Panel>
        </div>
      </section>
    </main>
  );
}
