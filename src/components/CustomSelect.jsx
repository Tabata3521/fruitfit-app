import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, X } from "lucide-react";
import { useState } from "react";

function optionParts(option) {
  return {
    value: Array.isArray(option) ? option[0] : option,
    label: Array.isArray(option) ? option[1] : option,
  };
}

export default function CustomSelect({ label, value, options, error, onChange }) {
  const active = options.map(optionParts).find((option) => option.value === value);

  return (
    <div className="block">
      <span className="text-[11px] font-bold uppercase text-appMuted">{label}</span>
      <SelectButton
        label={active?.label || "Выбрать"}
        options={options}
        value={value}
        onChange={onChange}
        title={label}
        error={error}
      />
      {error && <p className="mt-1 text-[11px] font-semibold text-red-500">{error}</p>}
    </div>
  );
}

export function SelectButton({ label, title, value, options, onChange, error }) {
  const [open, setOpen] = useOpenState();
  const normalized = options.map(optionParts);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mt-1 flex h-12 w-full items-center justify-between rounded-2xl border bg-appBg px-3 text-left text-[13px] font-bold text-appText outline-none ${error ? "border-red-300" : "border-appBorder"}`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={16} className="shrink-0 text-appMuted" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 px-3"
            onClick={() => setOpen(false)}
          >
            <motion.section
              initial={{ y: 36 }}
              animate={{ y: 0 }}
              exit={{ y: 36 }}
              transition={{ type: "spring", stiffness: 360, damping: 32 }}
              onClick={(event) => event.stopPropagation()}
              className="mb-[max(10px,env(safe-area-inset-bottom))] w-full max-w-[430px] rounded-[28px] border border-white/10 bg-[#101711] p-3 shadow-soft"
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <h3 className="text-[18px] font-black text-white">{title}</h3>
                <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/8 text-white">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-2">
                {normalized.map((option) => {
                  const selected = option.value === value;
                  return (
                    <button
                      type="button"
                      key={option.value}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className={`flex min-h-12 w-full items-center justify-between rounded-2xl px-4 text-left text-[14px] font-bold transition ${selected ? "bg-appGreen text-[#181F19]" : "bg-white/7 text-white"}`}
                    >
                      <span>{option.label}</span>
                      {selected && <Check size={18} />}
                    </button>
                  );
                })}
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function useOpenState() {
  return useState(false);
}
