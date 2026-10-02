const activities = [
  {
    title: "徐汇创意菜约饭局",
    date: "2026-06-26 19:00",
    status: "报名中",
    fee: "服务费 39 元"
  },
  {
    title: "静安咖啡餐厅兴趣体验",
    date: "2026-06-27 12:30",
    status: "候补开放",
    fee: "订位费 29 元"
  }
];

export function ActivitiesView(): JSX.Element {
  return (
    <div className="ops-view">
      <header className="ops-view__header">
        <h2>活动管理</h2>
        <p>查看活动排期、报名状态和费用口径。</p>
      </header>

      <div className="ops-cards">
        {activities.map((activity) => (
          <article className="ops-card" key={activity.title}>
            <h3>{activity.title}</h3>
            <p>{activity.date}</p>
            <dl>
              <dt>状态</dt>
              <dd>{activity.status}</dd>
              <dt>费用</dt>
              <dd>{activity.fee}</dd>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
