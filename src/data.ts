export const kpis = [
  { label: '实时交易额', value: '¥ 84.62M', delta: '+12.8%', tone: 'cyan' },
  { label: '活跃终端', value: '18,409', delta: '+5.4%', tone: 'amber' },
  { label: '订单履约率', value: '97.36%', delta: '+2.1%', tone: 'green' },
  { label: '告警压降', value: '31.7%', delta: '-8.9%', tone: 'rose' },
] as const;

export const cityFlow = [
  { city: '上海', value: 92 },
  { city: '深圳', value: 86 },
  { city: '北京', value: 78 },
  { city: '杭州', value: 71 },
  { city: '成都', value: 63 },
  { city: '武汉', value: 57 },
];

export const hourlyTrend = [36, 48, 42, 58, 76, 69, 88, 81, 95, 91, 104, 118];

export const channelShare = [
  { name: '移动端', value: 46, color: '#19d6ff' },
  { name: '门店', value: 24, color: '#f7c948' },
  { name: '小程序', value: 18, color: '#69f0ae' },
  { name: '企业端', value: 12, color: '#ff6b9a' },
];

export const eventList = [
  { level: '高', title: '华东节点流量突增', time: '09:42:18', status: '已扩容' },
  { level: '中', title: '智能补货模型刷新', time: '09:38:04', status: '运行中' },
  { level: '低', title: '西南仓温控校准完成', time: '09:27:51', status: '已闭环' },
  { level: '中', title: '会员转化漏斗波动', time: '09:12:39', status: '观察' },
];

export const nodes = [
  { name: '北部枢纽', x: 50, y: 28, pulse: 1.2 },
  { name: '华东核心', x: 72, y: 48, pulse: 0.7 },
  { name: '华南边缘', x: 61, y: 70, pulse: 1.5 },
  { name: '西南中心', x: 34, y: 66, pulse: 0.9 },
  { name: '中部中继', x: 45, y: 50, pulse: 1.8 },
];
