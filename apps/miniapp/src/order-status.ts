const labels: Record<string, string> = {
  PENDING_PAYMENT: "待付款", PAID_PENDING_GROUP: "已付款，待成团", GROUPED: "已成团",
  REFUND_REVIEWING: "退款审核中", REFUNDING: "退款处理中", REFUNDED: "已退款",
  COMPLETED: "已完成", CANCELED: "已取消", CLOSED: "已关闭", FAILED: "失败，待处理",
  REVIEWING: "审核中", APPROVED: "已批准，待处理", PROCESSING: "处理中", SUCCEEDED: "已完成", REJECTED: "审核未通过",
};
export function orderStatusLabel(status: string): string { return labels[status] ?? "状态待确认"; }
