import { createPaymentSession, paymentPageUrl } from "../data/paymentStore";

export async function openProfileProgramAction() {
  const session = await createPaymentSession({
    productCode: "program_subscription",
    recurringEnabled: true,
  });
  const url = paymentPageUrl(session);
  if (!url) throw new Error("Не удалось подготовить переход. Попробуйте позже.");
  window.location.href = url;
  return { kind: "external_checkout" };
}

export async function openLectureProgramAction() {
  const session = await createPaymentSession({
    productCode: "individual_program",
    recurringEnabled: false,
  });
  if (!session?.id) throw new Error("Сервер не вернул платёжную сессию.");
  window.location.href = paymentPageUrl(session);
  return { kind: "external_checkout" };
}
