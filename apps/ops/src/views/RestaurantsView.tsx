const restaurants = [
  {
    name: "衡山路创意菜",
    area: "徐汇",
    status: "可排期",
    seats: "2 桌"
  },
  {
    name: "南京西路咖啡餐厅",
    area: "静安",
    status: "资料待补充",
    seats: "1 桌"
  }
];

export function RestaurantsView(): JSX.Element {
  return (
    <div className="ops-view">
      <header className="ops-view__header">
        <h2>餐厅管理</h2>
        <p>维护餐厅基础资料、区域和可排桌资源。</p>
      </header>

      <div className="ops-table" role="table" aria-label="餐厅列表">
        <div className="ops-table__row ops-table__row--head" role="row">
          <span>餐厅</span>
          <span>区域</span>
          <span>状态</span>
          <span>桌位</span>
        </div>
        {restaurants.map((restaurant) => (
          <div className="ops-table__row" key={restaurant.name} role="row">
            <span>{restaurant.name}</span>
            <span>{restaurant.area}</span>
            <span>{restaurant.status}</span>
            <span>{restaurant.seats}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
