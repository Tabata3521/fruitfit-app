import { cancelPaymentSubscription, fetchPaymentSubscription, fetchPaymentSubscriptionCancelUrl } from "../data/paymentStore";

export async function fetchProgramRenewal() {
  return fetchPaymentSubscription();
}

export async function fetchProgramRenewalCancelInfo() {
  return fetchPaymentSubscriptionCancelUrl();
}

export async function cancelProgramRenewal(reason = "client_request") {
  return cancelPaymentSubscription(reason);
}
