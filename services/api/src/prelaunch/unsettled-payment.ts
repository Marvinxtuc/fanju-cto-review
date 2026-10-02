// Preparation is a separate axis from money. A saved prepay reference does not
// prove payment, and an unknown preparation result does not prove its absence.
export function isUnsettledPayment(intent:{state:string;preparationState:string;prepayId:string|null}){
 return ['NEW','SUBMITTING','UNKNOWN'].includes(intent.state)
  && ['NOT_STARTED','SUBMITTING','UNKNOWN','PREPARED'].includes(intent.preparationState)
  && (intent.preparationState!=='PREPARED'||!!intent.prepayId?.trim());
}
