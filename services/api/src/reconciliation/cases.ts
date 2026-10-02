import type { PrismaClient } from "../generated/prisma/client.js";

// Local runbook operations; no financial state may be edited through a case conclusion.
export async function resolveVerifiedCase(db: PrismaClient, input: { caseId: string; operator: string; reviewer: string }) {
  if (!input.operator.trim() || !input.reviewer.trim() || input.operator === input.reviewer) throw new Error("Independent review required");
  return db.$transaction(async tx => {
    const issue = await tx.financialCase.findUniqueOrThrow({ where: { id: input.caseId } });
    if (issue.owner !== input.operator) throw new Error("Case owner required");
    if (issue.state === "RESOLVED") return issue;
    let proof: string | undefined;
    if (issue.category === "UNASSOCIATED_RECEIPT") {
      const receipt = await tx.channelReceipt.findUnique({ where: { id: issue.sourceRef }, include: { payment: true } });
      if (receipt?.payment && receipt.orderId === receipt.payment.orderId && receipt.merchantScope === receipt.payment.merchantScope
        && receipt.merchantOrderNo === receipt.payment.merchantOrderNo && receipt.amountCents === receipt.payment.amountCents) proof = `receipt:${receipt.id}`;
    } else if (issue.category === "LEGACY_REFUND_REQUIRES_EVIDENCE" || issue.category === "REFUND_NOT_CONVERGED") {
      const refund = await tx.refund.findUnique({ where: { id: issue.sourceRef } });
      if (refund?.receiptId && refund.channelRefundNo && refund.status === "SUCCEEDED" && refund.resolutionState === "CONFIRMED") proof = `refund:${refund.id}`;
    } else if (issue.category === "JOB_REQUIRES_REVIEW") {
      const job = await tx.durableJob.findUnique({ where: { id: issue.sourceRef } });
      if (job?.kind === "RECOVER_PAYMENT") {
        const payment = await tx.payment.findUnique({ where: { id: job.refId } });
        if (payment && ["CONFIRMED", "CLOSED"].includes(payment.resolutionState)) proof = `payment:${payment.id}:${payment.version}`;
      } else if (job?.kind === "RECOVER_REFUND") {
        const refund = await tx.refund.findUnique({ where: { id: job.refId } });
        if (refund?.resolutionState === "CONFIRMED") proof = `refund:${refund.id}:${refund.version}`;
      } else if (job?.kind === "APPLY_EVENT") {
        const event = await tx.receivedEvent.findUnique({ where: { id: job.refId } });
        if (event?.state === "APPLIED") proof = `event:${event.id}`;
      }
    }
    if (!proof) throw new Error("Case has no supported terminal evidence; keep open");
    const changed = await tx.financialCase.updateMany({ where: { id: issue.id, state: "OPEN", updatedAt: issue.updatedAt }, data: {
      state: "RESOLVED", resolution: proof, reviewedBy: input.reviewer, reviewedAt: new Date(),
    } });
    if (!changed.count) throw new Error("Case changed during review");
    await tx.auditLog.create({ data: { action: "funding.case.resolve", targetType: "FinancialCase", targetId: issue.id,
      metadata: { operator: input.operator, reviewer: input.reviewer, proof } } });
    return tx.financialCase.findUniqueOrThrow({ where: { id: issue.id } });
  });
}
