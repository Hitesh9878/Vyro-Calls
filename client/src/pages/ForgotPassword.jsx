import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../services/api';
import Brand from '../components/Brand';
import OtpInput from '../components/OtpInput';
import useCountdown from '../hooks/useCountdown';
import './Auth.css';

// Step 1: email -> 6-digit code is emailed.  Step 2: code + new password.  Step 3: done.
export default function ForgotPassword() {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, resetWait] = useCountdown(30);

  const sendCode = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      resetWait();
      setStep('reset');
    } catch (err) {
      setError(errorMessage(err, 'Could not send the code'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    setInfo('');
    try {
      await api.post('/auth/resend-otp', { email, purpose: 'reset' });
      setInfo('A new code is on its way.');
      setOtp('');
      resetWait();
    } catch (err) {
      setError(errorMessage(err, 'Could not resend the code'));
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (password !== confirm) {
      setError('The two passwords don’t match');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { email, otp, password });
      setStep('done');
    } catch (err) {
      setError(errorMessage(err, 'Could not reset your password'));
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Brand />

        {step === 'email' && (
          <>
            <h1>Forgot your password?</h1>
            <p className="auth-subtitle">Enter your email and we’ll send you a 6-digit code.</p>
            <form className="auth-form" onSubmit={sendCode}>
              <label className="auth-field">
                Email
                <input
                  className="input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              {error && <p className="error-text">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </form>
          </>
        )}

        {step === 'reset' && (
          <>
            <h1>Enter code &amp; new password</h1>
            <p className="auth-subtitle">
              If an account exists for <span className="auth-sent-to">{email}</span>, we sent it a 6-digit code. It
              expires in 10 minutes.
            </p>
            <form className="auth-form" onSubmit={resetPassword}>
              <OtpInput value={otp} onChange={setOtp} disabled={busy} />
              <label className="auth-field">
                New password
                <input
                  className="input"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </label>
              <label className="auth-field">
                Confirm new password
                <input
                  className="input"
                  type="password"
                  placeholder="Type it again"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={6}
                  required
                />
              </label>
              {error && <p className="error-text">{error}</p>}
              {info && <p className="auth-success">{info}</p>}
              <button className="btn btn-primary" type="submit" disabled={busy || otp.length !== 6}>
                {busy ? 'Saving…' : 'Update password'}
              </button>
            </form>
            <p className="auth-resend">
              Didn’t get it?{' '}
              <button className="auth-link-btn" onClick={resend} disabled={wait > 0}>
                {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
              </button>
            </p>
          </>
        )}

        {step === 'done' && (
          <>
            <h1>Password updated</h1>
            <p className="auth-success">Your password has been changed. You can now sign in.</p>
          </>
        )}

        <p className="auth-switch">
          <Link to="/login">{step === 'done' ? 'Sign in with your new password' : 'Back to sign in'}</Link>
        </p>
      </div>
    </div>
  );
}
