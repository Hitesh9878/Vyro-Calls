import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

// Returns the connected socket (or null until it has been created)
export const useSocket = () => useContext(SocketContext);

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token) return;

    const options = { auth: { token } };
    const s = SERVER_URL ? io(SERVER_URL, options) : io(options);
    setSocket(s);

    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [token]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}
