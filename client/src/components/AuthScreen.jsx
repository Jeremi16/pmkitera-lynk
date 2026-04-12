import React from "react";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Link as LinkIcon,
  Loader2,
  Shield,
} from "lucide-react";
import { cn } from "../lib/utils";

export default function AuthScreen({
  authMode,
  authForm,
  authLoading,
  error,
  onChange,
  onSubmit,
  onToggleMode,
}) {
  return (
    <div className="min-h-screen auth-shell">
      <div className="auth-backdrop" />
      <div className="max-w-6xl mx-auto px-4 py-10 md:py-16 relative">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)] items-stretch">
          <section className="panel auth-hero">
            <div className="space-y-5">
              <span className="inline-flex items-center gap-2 badge badge-dark">
                <Shield size={14} />
                Secure Link Ops
              </span>
              <h1 className="text-4xl md:text-6xl font-black tracking-[-0.05em] leading-[0.95] text-slate-950">
                QR shortener with real auth, analytics, and provider fallback.
              </h1>
              <p className="text-base md:text-lg text-slate-600 max-w-2xl">
                Sign in to manage internal short links, Short.io backups, click
                analytics, expiry policies, and admin audit history from one
                workspace.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="feature-card">
                <LinkIcon size={18} />
                <strong>Link control</strong>
                <p>Create, disable, expire, and search links precisely.</p>
              </div>
              <div className="feature-card">
                <BarChart3 size={18} />
                <strong>Analytics</strong>
                <p>Track click volume, top links, and recent activity.</p>
              </div>
              <div className="feature-card">
                <Shield size={18} />
                <strong>Roles</strong>
                <p>Admin users can inspect audit trails and team-wide stats.</p>
              </div>
            </div>
          </section>

          <section className="panel auth-card">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {authMode === "login" ? "Sign In" : "Create Account"}
              </p>
              <h2 className="text-2xl font-bold text-slate-900">
                {authMode === "login"
                  ? "Enter your workspace"
                  : "Provision your first operator"}
              </h2>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              {authMode === "register" && (
                <div className="space-y-2">
                  <label className="label-text">Name</label>
                  <input
                    className="input-field"
                    value={authForm.name}
                    onChange={(event) => onChange("name", event.target.value)}
                    placeholder="Jeremi"
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="label-text">Email</label>
                <input
                  className="input-field"
                  type="email"
                  value={authForm.email}
                  onChange={(event) => onChange("email", event.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="label-text">Password</label>
                <input
                  className="input-field"
                  type="password"
                  value={authForm.password}
                  onChange={(event) => onChange("password", event.target.value)}
                  placeholder="At least 8 chars with upper/lower/number"
                  required
                />
              </div>

              {error && (
                <div className="feedback feedback-error">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button
                className="btn-primary w-full h-12"
                disabled={authLoading}
              >
                {authLoading ? (
                  <Loader2 className="animate-spin" />
                ) : authMode === "login" ? (
                  <>
                    <ArrowRight size={16} />
                    Continue to dashboard
                  </>
                ) : (
                  <>
                    <Shield size={16} />
                    Create account
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              className="btn-secondary w-full"
              onClick={onToggleMode}
            >
              {authMode === "login"
                ? "Need an account? Register"
                : "Already registered? Login"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
