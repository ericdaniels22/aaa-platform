"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

// role lives on user_organizations (scoped to a specific membership) since
// build48. UserProfile exposes it as a flat string for display — sourced
// from the active-org membership. When workspace switching lands in 18c,
// this resolver becomes dynamic.
// TODO(18b): replace AAA_ORGANIZATION_ID with session-sourced org.
const AAA_ORGANIZATION_ID = "a0000000-0000-4000-8000-000000000001";

interface UserProfile {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
  profile_photo_path: string | null;
  is_active: boolean;
  last_login_at: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  permissions: Record<string, boolean>;
  loading: boolean;
  hasPermission: (key: string) => boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const supabase = createClient();

    // Fetch profile (no role column after build48).
    const { data: profileData } = await supabase
      .from("user_profiles")
      .select("id, full_name, phone, profile_photo_path, is_active, last_login_at")
      .eq("id", userId)
      .maybeSingle();

    // Fetch role + membership id from user_organizations scoped to active org.
    const { data: membership } = await supabase
      .from("user_organizations")
      .select("id, role")
      .eq("user_id", userId)
      .eq("organization_id", AAA_ORGANIZATION_ID)
      .maybeSingle<{ id: string; role: string }>();

    if (profileData) {
      setProfile({ ...(profileData as Omit<UserProfile, "role">), role: membership?.role ?? "crew_member" });

      // Update last_login_at
      await supabase
        .from("user_profiles")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", userId);
    }

    // Fetch permissions from user_organization_permissions by membership id.
    if (membership) {
      const { data: permsData } = await supabase
        .from("user_organization_permissions")
        .select("permission_key, granted")
        .eq("user_organization_id", membership.id);

      if (permsData) {
        const permsMap: Record<string, boolean> = {};
        for (const p of permsData) {
          permsMap[p.permission_key] = p.granted;
        }
        setPermissions(permsMap);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  useEffect(() => {
    const supabase = createClient();

    // Get initial session — use getSession() first (reads cookies), fall back to getUser()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      let currentUser = session?.user ?? null;
      if (!currentUser) {
        // Fallback: try getUser() which verifies with Supabase server
        const { data } = await supabase.auth.getUser();
        currentUser = data.user;
      }
      setUser(currentUser);
      if (currentUser) {
        loadProfile(currentUser.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const newUser = session?.user ?? null;
        setUser(newUser);
        if (newUser) {
          loadProfile(newUser.id);
        } else {
          setProfile(null);
          setPermissions({});
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  function hasPermission(key: string): boolean {
    // Admin always has all permissions
    if (profile?.role === "admin") return true;
    return permissions[key] === true;
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setPermissions({});
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        permissions,
        loading,
        hasPermission,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
