const auditItems = [
  {
    time: "2026-06-24 10:00",
    actor: "ops-demo",
    action: "创建活动草稿",
    result: "已记录"
  },
  {
    time: "2026-06-24 10:20",
    actor: "ops-demo",
    action: "标记退款待审核",
    result: "已记录"
  }
];

export function AuditView(): JSX.Element {
  return (
    <div className="ops-view">
      <header className="ops-view__header">
        <h2>审计</h2>
        <p>展示高风险操作审计占位，后续接入后台鉴权和审计日志。</p>
      </header>

      <ol className="audit-list">
        {auditItems.map((item) => (
          <li className="audit-list__item" key={`${item.time}-${item.action}`}>
            <strong>{item.action}</strong>
            <span>{item.time}</span>
            <span>{item.actor}</span>
            <span>{item.result}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
