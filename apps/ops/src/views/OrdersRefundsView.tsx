const orders = [
  {
    id: "ORD-20260624-001",
    activity: "徐汇创意菜约饭局",
    amount: "39 元",
    state: "待成团",
    refund: "无"
  },
  {
    id: "ORD-20260624-002",
    activity: "静安咖啡餐厅兴趣体验",
    amount: "29 元",
    state: "取消审核中",
    refund: "T-24 前快速审核"
  }
];

export function OrdersRefundsView(): JSX.Element {
  return (
    <div className="ops-view">
      <header className="ops-view__header">
        <h2>订单/退款</h2>
        <p>静态展示订单状态、服务费/订位费和取消审核入口。</p>
      </header>

      <div className="ops-table" role="table" aria-label="订单和退款列表">
        <div className="ops-table__row ops-table__row--head" role="row">
          <span>订单号</span>
          <span>活动</span>
          <span>金额</span>
          <span>状态</span>
          <span>退款</span>
        </div>
        {orders.map((order) => (
          <div className="ops-table__row ops-table__row--wide" key={order.id} role="row">
            <span>{order.id}</span>
            <span>{order.activity}</span>
            <span>{order.amount}</span>
            <span>{order.state}</span>
            <span>{order.refund}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
