export async function fetchProgramRenewal() {
  return null;
}

export async function fetchProgramRenewalCancelInfo() {
  return { canCancel: false, message: "Статус программы можно уточнить у тренера." };
}

export async function cancelProgramRenewal() {
  return { skipped: true, message: "Статус программы можно уточнить у тренера." };
}
