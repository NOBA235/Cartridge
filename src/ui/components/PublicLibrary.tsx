/**
 * Optional Firestore Public Cartridge Library + Firebase Auth UI.
 *
 * Strictly public-only boundary:
 * - Browsing/installing downloads a public standard + compiled cartridge from
 *   Firestore and re-verifies SHA-256 and every rule quote locally before saving.
 * - Publishing requires Firebase Auth sign-in, explicit confirmation, and a
 *   confirmed public rulebook on this device; every publish logs exact bytes in
 *   'What left this device'. Private questions and diagrams never touch Firestore.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getFirebase } from '@/ai/firebase';
import { cartridgesStore, sourcesStore } from '@/cartridge/store';
import {
  installPublicCartridge,
  libraryAuth,
  listPublicCartridges,
  publishPublicCartridge,
  type PublicCartridgeDoc,
} from '@/library/firestoreLibrary';
import { useCartridges } from '@/ui/hooks/useCartridges';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/primitives/card';
import { href, linkHandler } from '@/ui/router';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function PublicLibrary() {
  const fb = getFirebase();
  const auth = useSyncExternalStore(libraryAuth.subscribe, libraryAuth.get);
  const { records } = useCartridges();

  const [entries, setEntries] = useState<PublicCartridgeDoc[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installedNote, setInstalledNote] = useState<Record<string, { id: string; text: string }>>(
    {},
  );
  const [installError, setInstallError] = useState<string | null>(null);

  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const applyLibrary = useCallback(
    (req: Promise<PublicCartridgeDoc[]>, isLive: () => boolean = () => true) =>
      req.then(
        (list) => {
          if (!isLive()) return;
          setEntries(list);
          setListError(null);
        },
        (e: unknown) => {
          if (!isLive()) return;
          setEntries([]);
          setListError(errorMessage(e));
        },
      ),
    [],
  );

  const loadLibrary = useCallback(async () => {
    if (!fb.ok) return;
    setRefreshing(true);
    try {
      await applyLibrary(listPublicCartridges(20));
    } finally {
      setRefreshing(false);
    }
  }, [fb.ok, applyLibrary]);

  useEffect(() => {
    if (!fb.ok) return;
    let live = true;
    void applyLibrary(listPublicCartridges(20), () => live);
    return () => {
      live = false;
    };
  }, [fb.ok, applyLibrary]);

  const loading = refreshing || (fb.ok && entries === null && listError === null);

  const handleAuth = async (fn: () => Promise<void>) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await fn();
    } catch (e) {
      setAuthError(errorMessage(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleInstall = async (entry: PublicCartridgeDoc) => {
    setInstallingId(entry.id);
    setInstallError(null);
    try {
      const res = await installPublicCartridge(entry);
      setInstalledNote((prev) => ({
        ...prev,
        [entry.id]: {
          id: res.cartridgeId,
          text: res.alreadyInstalled
            ? 'Already on this device — loaded into the slot.'
            : 'SHA-256 and all quotes verified locally — loaded into the slot.',
        },
      }));
    } catch (e) {
      setInstallError(errorMessage(e));
    } finally {
      setInstallingId(null);
    }
  };

  const handlePublish = async (cartridgeId: string) => {
    setPublishingId(cartridgeId);
    setPublishError(null);
    setPublishStatus(null);
    try {
      const cur = await cartridgesStore.current(cartridgeId);
      if (!cur) throw new Error('Could not load this cartridge from local storage.');
      if (!cur.record.sourceId) {
        throw new Error('The public rulebook for this cartridge is not on this device.');
      }
      const source = await sourcesStore.get(cur.record.sourceId);
      if (!source) {
        throw new Error('The public rulebook for this cartridge is not on this device.');
      }
      const doc = await publishPublicCartridge(cur.cartridge, source);
      setConfirmPublishId(null);
      setPublishStatus(
        `Published ‘${doc.name}’ (${doc.ruleCount} rules, ${doc.licence}) to the Public Library.`,
      );
      await loadLibrary();
    } catch (e) {
      setPublishError(errorMessage(e));
    } finally {
      setPublishingId(null);
    }
  };

  const publishable = (records ?? []).filter((r) => Boolean(r.sourceId));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Public Cartridge Library (Firebase Firestore)</CardTitle>
            <CardDescription className="mt-1">
              Install community-compiled public standards or share your own. Syncs{' '}
              <strong>only</strong> openly licensed, confirmed public standards and rules — private
              questions and diagrams stay strictly on this device.
            </CardDescription>
          </div>
          {fb.ok && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void loadLibrary()}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!fb.ok ? (
          <p className="text-sm text-muted-foreground">
            Firebase is not configured in this build ({fb.reason}). The local app still works
            offline.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              {auth.user ? (
                <>
                  <span>
                    Signed in as <strong>{auth.user.label}</strong>
                    {auth.user.isAnonymous ? ' (anonymous session)' : ''}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={authBusy}
                    onClick={() => void handleAuth(libraryAuth.signOut)}
                  >
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">
                    Anyone can browse and install public cartridges. Sign in to publish.
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={authBusy}
                      onClick={() => void handleAuth(libraryAuth.signInGoogle)}
                    >
                      Sign in with Google
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={authBusy}
                      onClick={() => void handleAuth(libraryAuth.signInGuest)}
                    >
                      Continue as guest
                    </Button>
                  </div>
                </>
              )}
            </div>
            {authError && (
              <p role="alert" className="text-xs text-destructive">
                Sign-in error: {authError}
              </p>
            )}

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Published public cartridges</h3>
              {listError && (
                <p
                  role="status"
                  className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground"
                >
                  Public library is not reachable right now ({listError}). Enable Firestore in the
                  Firebase Console and deploy <code>firestore.rules</code> to activate sharing.
                </p>
              )}
              {installError && (
                <p role="alert" className="text-xs text-destructive">
                  {installError}
                </p>
              )}
              {entries === null && loading ? (
                <p className="text-sm text-muted-foreground">Loading library…</p>
              ) : entries && entries.length === 0 && !listError ? (
                <p className="text-sm text-muted-foreground">
                  No cartridges have been published to this project yet. Publish one of your
                  verified public cartridges below.
                </p>
              ) : (
                entries &&
                entries.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {entries.map((entry) => {
                      const note = installedNote[entry.id];
                      return (
                        <li
                          key={entry.id}
                          className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="font-medium break-words">{entry.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {entry.ruleCount} rules ({entry.criticalCount} critical) · Licence:{' '}
                              {entry.licence} · By {entry.publishedByName} on{' '}
                              {new Date(entry.publishedAt).toLocaleDateString()}
                            </p>
                            {note && (
                              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-success">
                                <span>{note.text}</span>
                                <a
                                  href={href('/blueprint', { id: note.id })}
                                  onClick={linkHandler('/blueprint', { id: note.id })}
                                  className={buttonVariants({
                                    size: 'sm',
                                    variant: 'outline',
                                    className: 'h-6 px-2 text-xs',
                                  })}
                                >
                                  Open Blueprint
                                </a>
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0 self-start sm:self-center"
                            disabled={installingId !== null}
                            onClick={() => void handleInstall(entry)}
                          >
                            {installingId === entry.id
                              ? 'Verifying & installing…'
                              : 'Install & verify locally'}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </div>

            {publishable.length > 0 && (
              <div className="flex flex-col gap-3 border-t pt-4">
                <div>
                  <h3 className="text-sm font-semibold">Publish a local public cartridge</h3>
                  <p className="text-xs text-muted-foreground">
                    Uploads only the confirmed public rulebook text, licence, and compiled rules to
                    Firestore, and logs bytes sent in &lsquo;What left this device&rsquo;.
                  </p>
                </div>
                {publishStatus && (
                  <p role="status" className="text-xs font-medium text-success">
                    {publishStatus}
                  </p>
                )}
                {publishError && (
                  <p role="alert" className="text-xs text-destructive">
                    {publishError}
                  </p>
                )}
                <ul className="flex flex-col gap-2">
                  {publishable.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium break-words">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          v{r.currentVersion} · {r.ruleCount} rules
                        </p>
                      </div>
                      {confirmPublishId === r.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={!auth.user || publishingId !== null}
                            onClick={() => void handlePublish(r.id)}
                          >
                            {publishingId === r.id ? 'Publishing…' : 'Confirm public publish'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={publishingId !== null}
                            onClick={() => setConfirmPublishId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!auth.user || publishingId !== null}
                          title={
                            auth.user
                              ? 'Publish this confirmed public cartridge to Firestore'
                              : 'Sign in above to publish to the Public Cartridge Library'
                          }
                          onClick={() => {
                            setPublishError(null);
                            setPublishStatus(null);
                            setConfirmPublishId(r.id);
                          }}
                        >
                          Publish to library…
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
