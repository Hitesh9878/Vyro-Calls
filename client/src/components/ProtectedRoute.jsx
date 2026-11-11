import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { token, checking } = useAuth();

  if (checking) return null; // still validating the stored token
  if (!token) return <Navigate to="/login" replace />;
  return children;
}
