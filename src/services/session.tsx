import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from './firebase.ts';
import { ROLES, type ActorRole, type Role } from '../core/types.ts';

export interface Session {
  uid: string;
  email: string;
  kid: string;
  role: ActorRole;
  memberId: string | null;
  superadmin: boolean;
}

interface SessionState {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function isStaffRole(role: ActorRole): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          setSession(null);
          setLoading(false);
          return;
        }
        // Offline: token tersimpan di perangkat tetap bisa dibaca tanpa internet.
        const token = await user.getIdTokenResult();
        const c = token.claims as Record<string, unknown>;
        const role = typeof c.role === 'string' ? (c.role as ActorRole) : 'anggota';
        setSession({
          uid: user.uid,
          email: user.email ?? '',
          kid: typeof c.kid === 'string' ? c.kid : '',
          role,
          memberId: typeof c.mid === 'string' && c.mid !== '' ? c.mid : null,
          superadmin: false,
        });
        setLoading(false);
      }),
    [],
  );

  const value: SessionState = {
    session,
    loading,
    login: async (email, password) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    logout: () => signOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession harus di dalam SessionProvider');
  return v;
}
