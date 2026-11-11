import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { errorMessage } from '../services/api';
import Brand from '../components/Brand';
import OtpInput from '../components/OtpInput';
import useCountdown from '../hooks/useCountdown';
import './Auth.css';

export default function VerifyEmail() {
  const { verifyEmail } = useAuth();
  const navigate = useNavigate();
  const email = useLocation().state?.email;

  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, resetWait] = useCountdown(30);

  // Opened directly without going through sign-up
  if (!email) return <Navigate to="/register" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await verifyEmail(email, otp);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err, 'Could not verify your email'));
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    setInfo('');
    try {
      await api.post('/auth/resend-otp', { email, purpose: 'register' });
      setInfo('A new code is on its way.');
      setOtp('');
      resetWait();
    } catch (err) {
      setError(errorMessage(err, 'Could not resend the code'));
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Brand />
        <h1>Verify your email</h1>
        <p className="auth-subtitle">
          Enter the 6-digit code we sent to <span className="auth-sent-to">{email}</span>. It expires in 10 minutes.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <OtpInput value={otp} onChange={setOtp} disabled={busy} />

          {error && <p className="error-text">{error}</p>}
          {info && <p className="auth-success">{info}</p>}

          <button className="btn btn-primary" type="submit" disabled={busy || otp.length !== 6}>
            {busy ? 'Verifying…' : 'Verify & continue'}
          </button>
        </form>

        <p className="auth-resend">
          Didn’t get it?{' '}
          <button className="auth-link-btn" onClick={resend} disabled={wait > 0}>
            {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
          </button>
        </p>

        <p className="auth-switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
