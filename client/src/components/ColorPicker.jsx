import React, { useState, useRef, useEffect } from "react";
import { HexColorPicker } from "react-colorful";
import { cn } from "../lib/utils";

export default function ColorPicker({ color, onChange, label }) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleInputChange = (e) => {
    const newColor = e.target.value;
    onChange(newColor);
  };

  return (
    <div className="relative">
      <div
        className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm cursor-pointer transition-all hover:border-primary-300 hover:ring-2 hover:ring-primary-50 h-11"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div
          className="h-7 w-7 rounded-md border border-slate-200 shadow-inner flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="font-medium uppercase tracking-wide text-slate-600">
          {color}
        </span>
      </div>

      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute z-50 top-[calc(100%+8px)] left-0 p-4 bg-white/95 backdrop-blur-xl border border-slate-100 shadow-2xl rounded-2xl animate-fade-in"
        >
          <div className="mb-3">
            <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest">
              {label} Color
            </span>
          </div>
          
          <div className="custom-color-picker">
            <HexColorPicker color={color} onChange={onChange} />
          </div>

          <div className="mt-4 flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-100">
            <span className="pl-2 text-[10px] font-black text-slate-400 tracking-wider">HEX</span>
            <input
              type="text"
              value={color}
              onChange={handleInputChange}
              className="w-24 bg-white rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none transition-all uppercase"
            />
          </div>
        </div>
      )}
    </div>
  );
}
