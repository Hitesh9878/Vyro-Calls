import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { SocketProvider } from './context/SocketContext';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import VerifyEmail from './pages/VerifyEmail';
import Dashboard from './pages/Dashboard';

export default function App() {
  const { token, checking } = useAuth();

  if (checking) return null;

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={token ? <Navigate to="/" replace /> : <Register />} />
      <Route path="/forgot-password" element={token ? <Navigate to="/" replace /> : <ForgotPassword />} />
      <Route path="/verify-email" element={token ? <Navigate to="/" replace /> : <VerifyEmail />} />
      {/* Old emailed-link URL: password reset now uses a 6-digit code */}
      <Route path="/reset-password" element={<Navigate to="/forgot-password" replace />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <SocketProvider>
              <Dashboard />
            </SocketProvider>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
