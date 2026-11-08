"use client";

import { useActionState } from "react";
import { signIn, type Result } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<Result, FormData>(signIn, null);
  return (
    <form action={action}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" minLength={8} required />
      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" name="intent" value="signin" disabled={pending}>Sign in</button>
        <button name="intent" value="signup" disabled={pending}>Create account</button>
      </div>
      {state && <div className={`msg ${state.ok ? "ok" : "bad"}`}>{state.message}</div>}
    </form>
  );
}
