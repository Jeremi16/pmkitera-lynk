import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { TOKEN_STORAGE_KEY } from "../lib/constants";
import { formatApiError } from "../lib/utils";

export default function useAuth() {
  const navigate = useNavigate();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) || "");
  const [user, setUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(Boolean(token));
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  }, [token]);

  // Session bootstrap
  useEffect(() => {
    if (!token) { setUser(null); setSessionLoading(false); return; }
    let ignore = false;
    async function bootstrapSession() {
      setSessionLoading(true);
      try {
        const { data } = await api.get("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
        if (!ignore) { setUser(data.user); setSessionLoading(false); }
        if (data.user?.role === "admin") {
          try { await api.post("/admin/shortio/import", {}, { headers: { Authorization: `Bearer ${token}` } }); }
          catch (syncError) { console.error("Auto-sync failed:", syncError.message); }
        }
      } catch {
        if (!ignore) { setToken(""); setUser(null); setAuthError("Your session expired. Please login again."); setSessionLoading(false); }
      }
    }
    bootstrapSession();
    return () => { ignore = true; };
  }, [token]);

  const updateAuthField = useCallback((field, value) => setAuthForm((c) => ({ ...c, [field]: value })), []);

  const handleAuthSubmit = useCallback(async (event) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const endpoint = authMode === "login" ? "/auth/login" : "/auth/register";
      const payload = authMode === "login" ? { email: authForm.email, password: authForm.password } : authForm;
      const { data } = await api.post(endpoint, payload);
      setToken(data.token);
      setUser(data.user);
      setAuthForm({ name: "", email: "", password: "" });
      navigate("/");
    } catch (error) {
      setAuthError(formatApiError(error, "Authentication failed. Please try again."));
    } finally { setAuthLoading(false); }
  }, [authMode, authForm, navigate]);

  const handleLogout = useCallback(async () => {
    try { if (token) await api.post("/auth/logout", {}, { headers: { Authorization: `Bearer ${token}` } }); }
    catch { /* Ignore */ }
    setToken(""); setUser(null);
    navigate("/");
  }, [token, navigate]);

  const toggleAuthMode = useCallback(() => setAuthMode((c) => (c === "login" ? "register" : "login")), []);

  const clearAuth = useCallback((errorMsg) => { setToken(""); setUser(null); setAuthError(errorMsg || ""); }, []);

  return {
    token, user, isAdmin, sessionLoading,
    authMode, authForm, authLoading, authError,
    updateAuthField, handleAuthSubmit, handleLogout, toggleAuthMode, clearAuth,
    setMessage: null, // will be overridden by parent
  };
}
