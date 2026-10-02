/** datetime-local values represent the labelled Shanghai calendar, independently of browser TZ. */
export function shanghaiInputToIso(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) throw Error("请填写有效上海时间");
  const value = new Date(`${raw}+08:00`);
  if (!Number.isFinite(value.getTime())) throw Error("请填写有效上海时间");
  const calendar = new Date(value.getTime() + 8 * 3600000).toISOString().slice(0, raw.length);
  if (calendar !== raw) throw Error("请填写有效上海时间");
  return value.toISOString();
}
