import { useCallback, useEffect, useRef, useState } from "react";
import QRCodeStyling from "qr-code-styling";
import { DEFAULT_SETTINGS, QR_DEFAULT_SIZE } from "../lib/constants";
import { applyQrSettings } from "../lib/utils";

export default function useQrCode() {
  const qrRef = useRef(null);
  const qrModalRef = useRef(null);
  const editQrRef = useRef(null);
  const [activeQrLink, setActiveQrLink] = useState(null);

  const [qrCode] = useState(() => new QRCodeStyling({ width: QR_DEFAULT_SIZE, height: QR_DEFAULT_SIZE, type: "svg", dotsOptions: { color: DEFAULT_SETTINGS.dotsColor, type: DEFAULT_SETTINGS.dotsType }, backgroundOptions: { color: DEFAULT_SETTINGS.backgroundColor }, imageOptions: { crossOrigin: "anonymous", margin: 10 } }));
  const [qrModalCode] = useState(() => new QRCodeStyling({ width: QR_DEFAULT_SIZE, height: QR_DEFAULT_SIZE, type: "svg", dotsOptions: { color: DEFAULT_SETTINGS.dotsColor, type: DEFAULT_SETTINGS.dotsType }, backgroundOptions: { color: DEFAULT_SETTINGS.backgroundColor }, imageOptions: { crossOrigin: "anonymous", margin: 10 } }));
  const [editQrCode] = useState(() => new QRCodeStyling({ width: QR_DEFAULT_SIZE, height: QR_DEFAULT_SIZE, type: "svg", dotsOptions: { color: DEFAULT_SETTINGS.dotsColor, type: DEFAULT_SETTINGS.dotsType }, backgroundOptions: { color: DEFAULT_SETTINGS.backgroundColor }, imageOptions: { crossOrigin: "anonymous", margin: 10 } }));

  const renderCreateQr = useCallback((data, settings) => {
    applyQrSettings(qrCode, data, settings);
    if (qrRef.current) {
      if (qrRef.current.firstChild) qrRef.current.removeChild(qrRef.current.firstChild);
      qrCode.append(qrRef.current);
    }
  }, [qrCode]);

  const renderModalQr = useCallback((link) => {
    if (!link) return;
    const qrSettings = { ...DEFAULT_SETTINGS, ...(link.qrConfig || {}) };
    applyQrSettings(qrModalCode, link.short, qrSettings);
    if (qrModalRef.current) {
      if (qrModalRef.current.firstChild) qrModalRef.current.removeChild(qrModalRef.current.firstChild);
      qrModalCode.append(qrModalRef.current);
    }
  }, [qrModalCode]);

  const renderEditQr = useCallback((link, editDraftQrConfig) => {
    if (!link) return;
    const qrSettings = { ...DEFAULT_SETTINGS, ...(editDraftQrConfig || {}) };
    applyQrSettings(editQrCode, link.short, qrSettings);
    if (editQrRef.current) {
      if (editQrRef.current.firstChild) editQrRef.current.removeChild(editQrRef.current.firstChild);
      editQrCode.append(editQrRef.current);
    }
  }, [editQrCode]);

  // Escape key closes modal
  useEffect(() => {
    if (!activeQrLink) return undefined;
    function handleKeydown(event) { if (event.key === "Escape") setActiveQrLink(null); }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeQrLink]);

  // Render modal QR when active link changes
  useEffect(() => { renderModalQr(activeQrLink); }, [activeQrLink, renderModalQr]);

  const downloadCreateQr = useCallback((extension, createQrData, setMessage) => {
    if (!createQrData) { setMessage({ type: "error", text: "Isi URL dulu atau generate short link sebelum download QR." }); return; }
    const name = createQrData.replace(/^https?:\/\//, "").replace(/[^\w-]/g, "-") || `qr-${Date.now()}`;
    qrCode.download({ name, extension });
  }, [qrCode]);

  const downloadLinkQr = useCallback((extension, setMessage) => {
    if (!activeQrLink?.short) { setMessage({ type: "error", text: "QR data is not available yet." }); return; }
    const name = activeQrLink.short.replace(/^https?:\/\//, "").replace(/[^\w-]/g, "-");
    qrModalCode.download({ name, extension });
  }, [activeQrLink, qrModalCode]);

  return {
    qrRef, qrModalRef, editQrRef, activeQrLink, setActiveQrLink,
    renderCreateQr, renderEditQr, downloadCreateQr, downloadLinkQr,
  };
}
