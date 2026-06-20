import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { appIcons } from "../config/appIcons";
import { useAppIcon } from "../data/appIconStore";

export default function AppIconSettings({ compact = false }) {
  const { iconId, status, selectIcon } = useAppIcon();
  const [open, setOpen] = useState(!compact);
  const current = appIcons.find((item) => item.id === iconId) || appIcons[0];

  return (
    <section className="overflow-hidden rounded-[26px] border border-appBorder bg-appCard shadow-sm">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <span className="flex min-w-0 items-center gap-3">
          <img src={current.preview} alt="" className="h-12 w-12 shrink-0 rounded-2xl bg-black object-cover" />
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-appMuted">Внешний вид</span>
            <span className="mt-0.5 block text-[16px] font-black text-appText">Ярлык приложения</span>
            <span className="mt-0.5 block text-[12px] text-appMuted">Сейчас: {current.label}</span>
          </span>
        </span>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-appBg text-appText transition ${open ? "rotate-180" : ""}`}>
          <ChevronDown size={18} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-appBorder">
            <div className="p-4 pt-3">
              <p className="mb-3 text-[12px] leading-5 text-appMuted">
                Выберите фруктовый ярлык. На iPhone иконка меняется системно, в web/PWA выбор сохраняется локально.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {appIcons.map((item) => {
                  const active = item.id === iconId;
                  return (
                    <div key={item.id} className={`rounded-[22px] border p-3 text-left transition ${active ? "border-appGreen bg-appGreen/20" : "border-appBorder bg-appBg"}`}>
                      <img src={item.preview} alt="" className="aspect-square w-full rounded-[18px] bg-black object-cover" loading="lazy" />
                      <span className="mt-3 block text-[13px] font-black text-appText">{item.label}</span>
                      <button type="button" onClick={() => selectIcon(item.id)} className={`mt-2 h-9 w-full rounded-full text-[11px] font-black ${active ? "bg-appGreen text-[#181F19]" : "bg-appCard text-appText"}`}>
                        {active ? "Выбрано" : "Использовать"}
                      </button>
                    </div>
                  );
                })}
              </div>
              {status && <p className="mt-3 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-semibold text-appMuted">{status}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
