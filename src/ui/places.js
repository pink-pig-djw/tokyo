// Landmarks and camera presets. `st` is the nearest metro station number in Tokyo's
// station-numbering scheme (line letter + number), drawn as the line-coloured badge.
// Camera: target (lon, lat, height) + distance, compass azimuth from target to
// camera (deg, 0 = north) and elevation angle (deg).

export const LINES = {
  G: '#f39700', // Ginza
  M: '#e60012', // Marunouchi
  H: '#9caeb7', // Hibiya
  C: '#00bb85', // Chiyoda
  Z: '#8f76d6', // Hanzomon
  E: '#b6007a', // Toei Oedo
  U: '#1d6fb8', // Yurikamome
  F: '#9c5e31', // Fukutoshin
  X: '#c9b37e', // (no station: viewpoints)
};

export const GROUPS = [
  { id: 'towers', zh: '高塔与天际线', ja: 'タワー' },
  { id: 'streets', zh: '街区与夜生活', ja: 'まち' },
  { id: 'green', zh: '皇居·车站·绿地', ja: '緑と歴史' },
  { id: 'views', zh: '远眺', ja: '眺望' },
];

export const PLACES = [
  {
    id: 'skytree', group: 'towers', zh: '东京晴空塔', ja: '東京スカイツリー', st: 'Z14', stName: '押上',
    lon: 139.8107, lat: 35.7101, h: 634, label: 634,
    cam: { y: 330, dist: 1250, az: 215, el: 13 },
    text: '2012 年开业，高 634 米，是世界最高的自立式电波塔。350 米处为天望甲板，450 米处为天望回廊；夜间灯光在淡蓝色的「粋」与紫色的「雅」之间交替。',
  },
  {
    id: 'tokyotower', group: 'towers', zh: '东京塔', ja: '東京タワー', st: 'E21', stName: '赤羽橋',
    lon: 139.74543, lat: 35.65859, h: 333, label: 333,
    cam: { y: 170, dist: 720, az: 140, el: 9 },
    text: '1958 年竣工，高 333 米。橙白相间的涂装是航空安全规定的要求；夜间的「Landmark Light」冬季为橙色、夏季为白色。',
  },
  {
    id: 'azabudai', group: 'towers', zh: '麻布台之丘', ja: '麻布台ヒルズ', st: 'H05', stName: '神谷町',
    lon: 139.7406, lat: 35.6608, h: 325, label: 325,
    cam: { y: 170, dist: 820, az: 105, el: 12 },
    text: '2023 年开业，主楼森 JP 塔高约 325 米，是目前日本最高的大楼，与东京塔隔街相望。',
  },
  {
    id: 'roppongi', group: 'towers', zh: '六本木新城', ja: '六本木ヒルズ', st: 'H04', stName: '六本木',
    lon: 139.7292, lat: 35.6604, h: 238, label: 238,
    cam: { y: 140, dist: 800, az: 235, el: 14 },
    text: '2003 年开业的复合街区，核心的森大厦高 238 米，顶层设有展望台与美术馆。',
  },
  {
    id: 'tocho', group: 'towers', zh: '东京都厅', ja: '東京都庁', st: 'E28', stName: '都庁前',
    lon: 139.6917, lat: 35.6895, h: 243, label: 243,
    cam: { y: 130, dist: 950, az: 100, el: 13 },
    text: '1991 年落成，由丹下健三设计，双塔高 243 米。新宿西口超高层群就从这里展开。',
  },
  {
    id: 'sunshine', group: 'towers', zh: '池袋阳光 60', ja: 'サンシャイン60', st: 'M25', stName: '池袋',
    lon: 139.7196, lat: 35.7295, h: 240, label: 240,
    cam: { y: 120, dist: 900, az: 160, el: 15 },
    text: '1978 年竣工，高 240 米，曾是亚洲最高的大楼。',
  },
  {
    id: 'shibuya', group: 'streets', zh: '涩谷十字路口', ja: '渋谷スクランブル交差点', st: 'G01', stName: '渋谷',
    lon: 139.70056, lat: 35.6595, h: 0,
    cam: { y: 6, dist: 300, az: 305, el: 34 },
    text: '世界上最繁忙的路口之一：信号灯转绿时，行人从各个方向同时涌入。周围大楼外墙挂满巨型屏幕。',
  },
  {
    id: 'kabukicho', group: 'streets', zh: '新宿歌舞伎町', ja: '歌舞伎町', st: 'M08', stName: '新宿',
    lon: 139.7025, lat: 35.6945, h: 0,
    cam: { y: 15, dist: 420, az: 170, el: 28 },
    text: '日本最大的夜生活街区之一，竖向招牌与霓虹密集，入夜后才是它真正的样子。',
  },
  {
    id: 'ginza', group: 'streets', zh: '银座', ja: '銀座', st: 'G09', stName: '銀座',
    lon: 139.7650, lat: 35.6717, h: 0,
    cam: { y: 20, dist: 620, az: 150, el: 28 },
    text: '日本代表性的高级商业街。四丁目路口的和光钟楼建于 1932 年。',
  },
  {
    id: 'akihabara', group: 'streets', zh: '秋叶原', ja: '秋葉原', st: 'H16', stName: '秋葉原',
    lon: 139.7731, lat: 35.6984, h: 0,
    cam: { y: 15, dist: 500, az: 190, el: 28 },
    text: '电器街与动漫、游戏文化的中心，中央大道两侧满是广告屏与招牌。',
  },
  {
    id: 'asakusa', group: 'streets', zh: '浅草寺', ja: '浅草寺', st: 'G19', stName: '浅草',
    lon: 139.7962, lat: 35.7140, h: 0,
    cam: { y: 24, dist: 210, az: 215, el: 13 },
    text: '东京最古老的寺院，相传创建于 628 年。雷门与五重塔是这里的标志。',
  },
  {
    id: 'odaiba', group: 'streets', zh: '台场', ja: 'お台場', st: 'U06', stName: 'お台場海浜公園',
    lon: 139.7745, lat: 35.6270, h: 0,
    cam: { y: 30, dist: 1500, az: 165, el: 15 },
    text: '东京湾上的填海地区，从这里可以隔水眺望彩虹大桥与都心的天际线。',
  },
  {
    id: 'rainbow', group: 'streets', zh: '彩虹大桥', ja: 'レインボーブリッジ', st: 'U05', stName: '芝浦ふ頭',
    lon: null, lat: null, h: 126, label: 126,
    cam: { y: 55, dist: 1150, az: 150, el: 9 },
    text: '1993 年通车的双层悬索桥，全长 798 米、主跨 570 米、主塔高 126 米。上层是首都高速 11 号台场线，下层是一般道路与百合鸥线。',
  },
  {
    id: 'tokyostation', group: 'green', zh: '东京站丸之内站舍', ja: '東京駅丸の内駅舎', st: 'M17', stName: '東京',
    lon: 139.7656, lat: 35.6812, h: 0,
    cam: { y: 15, dist: 560, az: 265, el: 22 },
    text: '1914 年启用的红砖站舍，由辰野金吾设计，2012 年完成复原。正对皇居方向的行幸大道。',
  },
  {
    id: 'palace', group: 'green', zh: '皇居', ja: '皇居', st: 'C10', stName: '二重橋前',
    lon: 139.7528, lat: 35.6852, h: 0,
    cam: { y: 0, dist: 2000, az: 125, el: 34 },
    text: '江户城旧址，今天的天皇居所，被护城河与大片森林环绕，是都心最大的一片绿地。',
  },
  {
    id: 'diet', group: 'green', zh: '国会议事堂', ja: '国会議事堂', st: 'M14', stName: '国会議事堂前',
    lon: 139.7449, lat: 35.6759, h: 0,
    cam: { y: 25, dist: 520, az: 90, el: 18 },
    text: '1936 年落成的日本国会大楼，中央塔高约 65 米。',
  },
  {
    id: 'meiji', group: 'green', zh: '明治神宫', ja: '明治神宮', st: 'C03', stName: '明治神宮前',
    lon: 139.6993, lat: 35.6764, h: 0,
    cam: { y: 0, dist: 1500, az: 200, el: 38 },
    text: '1920 年创建。约 70 公顷的森林由全国捐献的约 10 万棵树木种植而成，如今已是一片自然林。',
  },
  {
    id: 'gyoen', group: 'green', zh: '新宿御苑', ja: '新宿御苑', st: 'M10', stName: '新宿御苑前',
    lon: 139.7100, lat: 35.6852, h: 0,
    cam: { y: 0, dist: 1300, az: 165, el: 32 },
    text: '融合日式、英式与法式庭园的国民公园，春天是东京最著名的赏樱地之一。',
  },
  {
    id: 'ueno', group: 'green', zh: '上野公园', ja: '上野恩賜公園', st: 'G16', stName: '上野',
    lon: 139.7714, lat: 35.7148, h: 0,
    cam: { y: 0, dist: 950, az: 175, el: 32 },
    text: '东京最热门的赏樱地之一，园内集中了国立博物馆、美术馆与动物园。',
  },
  {
    id: 'dome', group: 'green', zh: '东京巨蛋', ja: '東京ドーム', st: 'M22', stName: '後楽園',
    lon: 139.7519, lat: 35.7056, h: 0,
    cam: { y: 20, dist: 620, az: 185, el: 30 },
    text: '1988 年启用的室内棒球场，读卖巨人队的主场。',
  },
  {
    id: 'fuji', group: 'views', zh: '远眺富士山', ja: '富士山を望む', st: 'X', stName: '新宿上空',
    lon: 139.700, lat: 35.688, h: 0, view: { y: 520, az: 249, el: 1.2 },
    cam: null,
    text: '富士山位于东京西南约 100 公里外，海拔 3776 米。空气通透的冬日傍晚，常能从都心的高楼上看到它的剪影。',
  },
  {
    id: 'panorama', group: 'views', zh: '东京全景', ja: '東京パノラマ', st: 'X', stName: '都心上空',
    lon: 139.760, lat: 35.680, h: 0,
    cam: { y: 0, dist: 9000, az: 160, el: 24 },
    text: '从东京湾上空回望：都心的高层群、隅田川、皇居的森林与无边无际的低层街区。',
  },
];
