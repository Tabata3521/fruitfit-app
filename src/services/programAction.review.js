import { createTrainerRequest, fetchProfile, trainerRequestPageUrl } from "../data/authStore";

const TRAINER_REQUEST_MESSAGE = "Тренер рассмотрит заявку и свяжется с вами по электронной почте.";

export async function openProfileProgramAction({ profile = {}, source = "ios-profile", openExternalUrl } = {}) {
  const request = await createTrainerRequest({ profile, source });
  await openExternalUrl?.(trainerRequestPageUrl(request));
  return { kind: "trainer_request", request, message: TRAINER_REQUEST_MESSAGE };
}

export async function openLectureProgramAction({ source = "ios-lecture-6", openExternalUrl } = {}) {
  const profile = await fetchProfile();
  const request = await createTrainerRequest({ profile: profile || {}, source });
  await openExternalUrl?.(trainerRequestPageUrl(request));
  return { kind: "trainer_request", request, message: TRAINER_REQUEST_MESSAGE };
}
