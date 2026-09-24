'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    DeviceMobile,
    UsersThree,
    Trash,
    Plus,
    ArrowSquareOut,
    CircleNotch,
    CheckCircle,
    WarningCircle,
    Check,
    ArrowsClockwise,
    MagnifyingGlass,
    CaretDown,
    CaretUp,
    Info,
    WhatsappLogo,
    Sparkle,
    Lightning,
    ShieldCheck,
    Lock,
    Sliders
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { getRandomTimeQuote } from '@/lib/timeQuotes';
import {
    getStoredToken,
    getStoredUser,
    getUserProfile,
    getProfilePhoto,
    getUserPresence,
    getSubscriptionStatus,
    listSubBots,
    deleteSubBot,
    listGroups,
    listParticipatingGroups,
    addGroup,
    deleteGroup
} from '@/lib/api';
import type {
    SubscriptionStatusResponse,
    SubBotInstance,
    WhitelistedGroup,
    UserProfile,
    ParticipatingGroup
} from '@/lib/types';
import { PairingModal } from '@/components/PairingModal';
import { Container } from '@/components/ui/container';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';

function GroupAvatar({
    name,
    pictureUrl,
    size = 'md'
}: {
    name?: string;
    pictureUrl?: string | null;
    size?: 'sm' | 'md';
}) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 rounded-xl text-[10px]' : 'w-9 h-9 rounded-xl text-xs';

    const hasFailed = pictureUrl ? failedUrl === pictureUrl : true;

    if (pictureUrl && !hasFailed) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={pictureUrl}
                alt={name || 'Group'}
                referrerPolicy="no-referrer"
                onError={() => setFailedUrl(pictureUrl)}
                className={`${sizeClasses} object-cover shrink-0 border border-border/50 bg-muted shadow-2xs`}
            />
        );
    }

    const initials = name ? name.trim().slice(0, 2).toUpperCase() : 'GP';
    return (
        <div
            className={`${sizeClasses} bg-primary/10 text-primary flex items-center justify-center shrink-0 font-bold uppercase select-none`}
        >
            {initials}
        </div>
    );
}

function formatRedactedPhone(jidOrPhone?: string | null): string {
    if (!jidOrPhone) return '••••••••••••';
    const rawDigits = jidOrPhone.split('@')[0].replace(/\D/g, '');
    if (rawDigits.length <= 6) return rawDigits ? `+${rawDigits}` : '••••••••••••';

    let countryCode = '+62';
    let localDigits = rawDigits;
    if (rawDigits.startsWith('62')) {
        countryCode = '+62';
        localDigits = rawDigits.slice(2);
    } else if (rawDigits.startsWith('0')) {
        countryCode = '+62';
        localDigits = rawDigits.slice(1);
    } else {
        countryCode = `+${rawDigits.slice(0, 2)}`;
        localDigits = rawDigits.slice(2);
    }

    const firstGroup = localDigits.slice(0, 3);
    const lastGroup = localDigits.slice(-4);
    return `${countryCode} ${firstGroup} •••• ${lastGroup}`;
}

export default function DashboardPage() {
    const { t, language } = useTranslation();
    const router = useRouter();
    const dateLocale = language === 'id' ? 'id-ID' : 'en-US';

    const [isLoading, setIsLoading] = useState(true);
    const [subscription, setSubscription] = useState<SubscriptionStatusResponse | null>(null);
    const [subBots, setSubBots] = useState<SubBotInstance[]>([]);
    const [groups, setGroups] = useState<WhitelistedGroup[]>([]);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [timeQuote, setTimeQuote] = useState<string>('');
    const [fetchedAvatarUrl, setFetchedAvatarUrl] = useState<string | null>(null);
    const [fetchedBannerUrl, setFetchedBannerUrl] = useState<string | null>(null);
    const [avatarError, setAvatarError] = useState(false);
    const [bannerError, setBannerError] = useState(false);
    const [polledPresence, setPolledPresence] = useState<'online' | 'offline' | null>(null);
    const presence = polledPresence ?? userProfile?.presence ?? 'offline';

    const avatarUrl = userProfile?.profilePictureUrl || fetchedAvatarUrl;
    const placeholderAvatarUrl = userProfile?.avatarPlaceholderUrl ?? null;
    const bannerUrl = !bannerError ? (userProfile?.coverPictureUrl || fetchedBannerUrl || avatarUrl) : null;
    useEffect(() => {
        if (!userProfile?.id) return;
        let isMounted = true;
        const checkPresence = () => {
            getUserPresence()
                .then((res) => {
                    if (isMounted && res?.presence) {
                        setPolledPresence(res.presence);
                    }
                })
                .catch(() => {});
        };
        checkPresence();
        const interval = setInterval(checkPresence, 10000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [userProfile?.id]);

    useEffect(() => {
        if ((!userProfile?.profilePictureUrl || !userProfile?.coverPictureUrl) && userProfile?.id) {
            getProfilePhoto()
                .then((res) => {
                    if (res?.pictureUrl) {
                        setFetchedAvatarUrl(res.pictureUrl);
                    }
                    if (res?.coverUrl) {
                        setFetchedBannerUrl(res.coverUrl);
                    }
                })
                .catch(() => {});
        }
    }, [userProfile?.profilePictureUrl, userProfile?.coverPictureUrl, userProfile?.id]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe sync of client time-of-day quote
        setTimeQuote(getRandomTimeQuote(new Date().getHours(), language));
    }, [language]);

    // Pairing Modal state
    const [showPairModal, setShowPairModal] = useState(false);

    // Add Group / Account Groups state
    const [showAddGroupModal, setShowAddGroupModal] = useState(false);
    const [newGroupJid, setNewGroupJid] = useState('');
    const [isAddingGroup, setIsAddingGroup] = useState(false);
    const [addGroupError, setAddGroupError] = useState<string | null>(null);
    const [participatingGroups, setParticipatingGroups] = useState<ParticipatingGroup[]>([]);
    const [isLoadingAccountGroups, setIsLoadingAccountGroups] = useState(false);
    const [groupSearchQuery, setGroupSearchQuery] = useState('');
    const [addingGroupJid, setAddingGroupJid] = useState<string | null>(null);
    const [showManualJidInput, setShowManualJidInput] = useState(false);
    const [refreshCount, setRefreshCount] = useState(0);
    const [isBotsExpanded, setIsBotsExpanded] = useState(false);
    const [isGroupsExpanded, setIsGroupsExpanded] = useState(false);

    const groupNameMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const pg of participatingGroups) {
            if (pg.subject) map.set(pg.id, pg.subject);
        }
        return map;
    }, [participatingGroups]);

    const groupPictureMap = useMemo(() => {
        const map = new Map<string, string | null>();
        for (const pg of participatingGroups) {
            if (pg.pictureUrl) map.set(pg.id, pg.pictureUrl);
        }
        return map;
    }, [participatingGroups]);

    // Destructive Confirmation Dialog states
    const [botToDelete, setBotToDelete] = useState<string | null>(null);
    const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const reloadDashboardData = useCallback(() => {
        setIsLoading(true);
        setErrorMsg(null);
        setRefreshCount((prev) => prev + 1);
    }, []);

    useEffect(() => {
        let isMounted = true;

        async function fetchData() {
            const token = getStoredToken();
            if (!token) {
                router.push('/login');
                return;
            }

            const storedUser = getStoredUser();
            if (storedUser && isMounted) {
                setUserProfile(storedUser);
            }

            try {
                const [subData, botsData, groupsData, profileRes, participatingData] = await Promise.all([
                    getSubscriptionStatus().catch(() => ({
                        tier: 'FREE' as const,
                        status: 'ACTIVE' as const,
                        maxSubBots: 2,
                        maxGroups: 5,
                        customPrefix: false,
                        startedAt: new Date().toISOString(),
                        expiresAt: null,
                        currentSubBots: 0,
                        currentGroups: 0
                    })),
                    listSubBots().catch(() => []),
                    listGroups().catch(() => []),
                    getUserProfile().catch(() => null),
                    listParticipatingGroups().catch(() => null)
                ]);

                if (isMounted) {
                    setSubscription(subData);
                    setSubBots(botsData);
                    setGroups(groupsData);
                    if (participatingData?.groups) {
                        setParticipatingGroups(participatingData.groups);
                    }
                    if (profileRes?.user) {
                        setUserProfile(profileRes.user);
                    } else if (!storedUser) {
                        setUserProfile({
                            id: 'user@s.whatsapp.net',
                            username: 'Member',
                            email: null,
                            isWhitelisted: true,
                            language: 'ID',
                            balance: 0,
                            creditScore: 500,
                            createdAt: new Date().toISOString()
                        });
                    }
                }
            } catch (err: unknown) {
                if (isMounted) {
                    const msg = err instanceof Error ? err.message : t.common.error;
                    setErrorMsg(msg);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }

        void fetchData();

        return () => {
            isMounted = false;
        };
    }, [router, t.common.error, refreshCount]);

    const confirmDeleteSubBot = async () => {
        if (!botToDelete) return;
        setIsDeleting(true);
        try {
            await deleteSubBot(botToDelete);
            setSubBots((prev) => prev.filter((b) => b.id !== botToDelete));
            if (subscription) {
                setSubscription({
                    ...subscription,
                    currentSubBots: Math.max(0, subscription.currentSubBots - 1)
                });
            }
            setBotToDelete(null);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t.common.error;
            setErrorMsg(msg);
        } finally {
            setIsDeleting(false);
        }
    };

    const confirmDeleteGroup = async () => {
        if (!groupToDelete) return;
        setIsDeleting(true);
        try {
            await deleteGroup(groupToDelete);
            setGroups((prev) => prev.filter((g) => g.jid !== groupToDelete));
            if (subscription) {
                setSubscription({
                    ...subscription,
                    currentGroups: Math.max(0, subscription.currentGroups - 1)
                });
            }
            setGroupToDelete(null);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t.common.error;
            setErrorMsg(msg);
        } finally {
            setIsDeleting(false);
        }
    };

    const currentBotsCount = subBots.length;
    const maxBots = subscription?.maxSubBots || 2;
    const isBotsQuotaFull = currentBotsCount >= maxBots;

    const currentGroupsCount = groups.length;
    const maxGroups = subscription?.maxGroups || 5;
    const isGroupsQuotaFull = currentGroupsCount >= maxGroups;

    const loadAccountGroups = useCallback(async () => {
        setIsLoadingAccountGroups(true);
        setAddGroupError(null);
        try {
            const res = await listParticipatingGroups();
            setParticipatingGroups(res.groups || []);
        } catch (err: unknown) {
            console.warn('[Dashboard] Failed to fetch account groups:', err);
        } finally {
            setIsLoadingAccountGroups(false);
        }
    }, []);

    const handleOpenAddGroupModal = useCallback(() => {
        setShowAddGroupModal(true);
        setAddGroupError(null);
        setGroupSearchQuery('');
        setShowManualJidInput(false);
        loadAccountGroups();
    }, [loadAccountGroups]);

    const handleAddGroupDirect = async (groupJid: string) => {
        if (isGroupsQuotaFull) {
            setAddGroupError(t.dashboard.groupsCard.quotaReachedNotice);
            return;
        }

        setAddingGroupJid(groupJid);
        setAddGroupError(null);

        try {
            const created = await addGroup({ jid: groupJid });
            setGroups((prev) => {
                if (prev.some((g) => g.jid === created.jid)) return prev;
                return [...prev, created];
            });
            setParticipatingGroups((prev) => prev.map((g) => (g.id === groupJid ? { ...g, isWhitelisted: true } : g)));
            if (subscription) {
                setSubscription({
                    ...subscription,
                    currentGroups: subscription.currentGroups + 1
                });
            }
        } catch (err: unknown) {
            const errorObj = err as { data?: { code?: string; error?: string }; status?: number; message?: string };
            if (
                errorObj.data?.code === 'QUOTA_EXCEEDED' ||
                errorObj.data?.error === 'QUOTA_EXCEEDED' ||
                errorObj.status === 403
            ) {
                setAddGroupError(t.dashboard.groupsCard.quotaReachedNotice);
            } else {
                const msg = err instanceof Error ? err.message : t.common.error;
                setAddGroupError(msg);
            }
        } finally {
            setAddingGroupJid(null);
        }
    };

    const handleAddGroupSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const cleanJid = newGroupJid.trim();
        if (!cleanJid) return;

        if (!cleanJid.endsWith('@g.us')) {
            setAddGroupError(t.dashboard.invalidGroupJid);
            return;
        }

        if (isGroupsQuotaFull) {
            setAddGroupError(t.dashboard.groupsCard.quotaReachedNotice);
            return;
        }

        setIsAddingGroup(true);
        setAddGroupError(null);

        try {
            const created = await addGroup({ jid: cleanJid });
            setGroups((prev) => {
                if (prev.some((g) => g.jid === created.jid)) return prev;
                return [...prev, created];
            });
            setParticipatingGroups((prev) => prev.map((g) => (g.id === cleanJid ? { ...g, isWhitelisted: true } : g)));
            if (subscription) {
                setSubscription({
                    ...subscription,
                    currentGroups: subscription.currentGroups + 1
                });
            }
            setNewGroupJid('');
            setShowManualJidInput(false);
            setShowAddGroupModal(false);
        } catch (err: unknown) {
            const errorObj = err as { data?: { code?: string; error?: string }; status?: number; message?: string };
            if (
                errorObj.data?.code === 'QUOTA_EXCEEDED' ||
                errorObj.data?.error === 'QUOTA_EXCEEDED' ||
                errorObj.status === 403
            ) {
                setAddGroupError(t.dashboard.groupsCard.quotaReachedNotice);
            } else {
                const msg = err instanceof Error ? err.message : t.common.error;
                setAddGroupError(msg);
            }
        } finally {
            setIsAddingGroup(false);
        }
    };

    const displayName = userProfile?.username || userProfile?.pushName || userProfile?.id?.split('@')[0] || 'Member';

    return (
        <div className="flex flex-col w-full py-10">
            <Container size="lg" className="space-y-10">
                {/* Header: Clean, blends into website body, displaying "Welcome, {username}" + green checkmark */}
                <div className="space-y-1.5 border-b border-border pb-6">
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-foreground font-heading">
                            {t.dashboard.welcome} {displayName}
                        </h1>
                        <span title={t.dashboard.whitelistActive} className="inline-flex">
                            <CheckCircle className="w-6 h-6 text-emerald-500 shrink-0" weight="fill" />
                        </span>
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl italic">
                        &ldquo;{timeQuote || t.dashboard.headerSubtitle}&rdquo;
                    </p>
                </div>

                {/* Global Error Banner with Retry */}
                {errorMsg && (
                    <div
                        role="alert"
                        className="p-4 rounded-2xl bg-destructive/10 text-destructive text-xs sm:text-sm font-medium border border-destructive/20 flex items-center justify-between gap-4"
                    >
                        <div className="flex items-center gap-2">
                            <WarningCircle className="w-5 h-5 shrink-0" weight="bold" />
                            <span>{errorMsg}</span>
                        </div>
                        <button
                            type="button"
                            onClick={reloadDashboardData}
                            className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold shrink-0 cursor-pointer"
                        >
                            {t.common.retry}
                        </button>
                    </div>
                )}

                {/* Subscription & Quota Overview Grid */}
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <Skeleton className="h-48 rounded-3xl" />
                        <Skeleton className="h-48 rounded-3xl" />
                        <Skeleton className="h-48 rounded-3xl" />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* User Profile & Plan Status Card */}
                        <div className="rounded-3xl bg-card border border-border shadow-xs flex flex-col justify-between overflow-hidden relative group">
                            {/* Profile Header Banner */}
                            <div className="relative h-24 sm:h-28 w-full overflow-hidden bg-muted/70 shrink-0">
                                {bannerUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={bannerUrl}
                                        alt={userProfile?.username || 'Profile Banner'}
                                        referrerPolicy="no-referrer"
                                        className="w-full h-full object-cover object-center transform group-hover:scale-105 transition-transform duration-500 ease-out"
                                        onError={() => setBannerError(true)}
                                    />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-r from-emerald-600/20 via-primary/20 to-indigo-600/20" />
                                )}

                                {/* Subtle soft gradient overlay */}
                                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-transparent pointer-events-none" />
                                {/* WhatsApp Profile Header Pill Bar (inside banner) */}
                                <div className="absolute top-3.5 inset-x-4 flex items-center justify-between z-10">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-white drop-shadow-sm flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10">
                                        <WhatsappLogo className="w-3.5 h-3.5 text-emerald-400" weight="fill" />
                                        <span>{t.dashboard.userProfileCard?.title || 'WhatsApp Profile'}</span>
                                    </span>
                                    <span
                                        className={`text-[11px] px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5 backdrop-blur-md border shadow-xs ${
                                            presence === 'online'
                                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                                                : 'bg-black/40 text-zinc-300 border-white/10'
                                        }`}
                                    >
                                        <span
                                            className={`w-1.5 h-1.5 rounded-full ${
                                                presence === 'online'
                                                    ? 'bg-emerald-400 animate-pulse'
                                                    : 'bg-zinc-400'
                                            }`}
                                        />
                                        <span>
                                            {presence === 'online'
                                                ? t.dashboard.userProfileCard?.online || 'Online'
                                                : t.dashboard.userProfileCard?.offline || 'Offline'}
                                        </span>
                                    </span>
                                </div>

                                {/* Smooth frosted-glass fog transition at the bottom */}
                                <div
                                    className="absolute bottom-0 inset-x-0 h-16 pointer-events-none backdrop-blur-[6px]"
                                    style={{
                                        maskImage: 'linear-gradient(to top, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.4) 50%, rgba(0, 0, 0, 0) 100%)',
                                        WebkitMaskImage: 'linear-gradient(to top, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.4) 50%, rgba(0, 0, 0, 0) 100%)'
                                    }}
                                />
                                <div className="absolute bottom-0 inset-x-0 h-14 bg-gradient-to-t from-card via-card/50 to-transparent pointer-events-none" />
                            </div>

                            {/* Card Content (Avatar, Username, Plan Status) */}
                            <div className="px-6 pb-6 pt-0 space-y-4 flex-1 flex flex-col justify-between -mt-9 relative z-10">
                                <div>
                                    {/* User Details: Avatar overlapping Banner + Username + Redacted Phone */}
                                    <div className="flex items-end gap-3.5">
                                        <div className="relative shrink-0">
                                            <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-card bg-card shadow-md flex items-center justify-center ring-1 ring-border/80">
                                                {avatarUrl && !avatarError ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={avatarUrl}
                                                        alt={userProfile?.username || 'Profile'}
                                                        referrerPolicy="no-referrer"
                                                        className="w-full h-full object-cover"
                                                        onError={() => setAvatarError(true)}
                                                    />
                                                ) : placeholderAvatarUrl ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={placeholderAvatarUrl}
                                                        alt={userProfile?.username || 'Profile'}
                                                        referrerPolicy="no-referrer"
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full bg-gradient-to-br from-emerald-500/20 via-emerald-600/10 to-primary/20 flex items-center justify-center text-primary font-bold text-lg font-heading">
                                                        {(userProfile?.username || userProfile?.pushName || 'U')
                                                            .charAt(0)
                                                            .toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="absolute -bottom-1 -right-1 p-0.5 bg-card rounded-full shadow-xs">
                                                <div
                                                    className={`p-0.5 rounded-full text-white transition-colors ${
                                                        presence === 'online'
                                                            ? 'bg-emerald-500'
                                                            : 'bg-zinc-400 dark:bg-zinc-600'
                                                    }`}
                                                >
                                                    <WhatsappLogo className="w-3 h-3" weight="fill" />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="min-w-0 flex-1 space-y-0.5 pb-0.5">
                                            <h3 className="text-base font-bold text-foreground font-heading truncate">
                                                {userProfile?.username
                                                    ? `@${userProfile.username}`
                                                    : userProfile?.pushName || 'WhatsApp User'}
                                            </h3>
                                            <p className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 tracking-tight">
                                                <span>{formatRedactedPhone(userProfile?.id)}</span>
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Plan Status Info */}
                                <div className="mt-4 pt-3.5 border-t border-border/70 space-y-2.5">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                                            {subscription?.tier === 'PARTNER' ? (
                                                <ShieldCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" weight="fill" />
                                            ) : subscription?.tier === 'SUBSIDIZED' ? (
                                                <Lightning className="w-3.5 h-3.5 text-amber-500 shrink-0" weight="fill" />
                                            ) : (
                                                <Sparkle className="w-3.5 h-3.5 text-primary shrink-0" />
                                            )}
                                            <span>{t.dashboard.userProfileCard?.planStatus || 'Plan Status'}</span>
                                        </span>
                                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/60">
                                            {subscription?.expiresAt
                                                ? `${t.dashboard.validUntilPrefix} ${new Date(subscription.expiresAt).toLocaleDateString(dateLocale)}`
                                                : t.dashboard.planCard.perpetual}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-2xl font-black text-foreground font-heading tracking-tight">
                                                {subscription?.tier === 'PARTNER'
                                                    ? 'Zenith'
                                                    : subscription?.tier === 'SUBSIDIZED'
                                                      ? 'Nova'
                                                      : 'Pulse'}
                                            </span>
                                            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider font-mono">
                                                {subscription?.tier === 'PARTNER'
                                                    ? 'Partner'
                                                    : subscription?.tier === 'SUBSIDIZED'
                                                      ? 'Subsidized'
                                                      : 'Free'}
                                            </span>
                                        </div>

                                        <div
                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors border ${
                                                subscription?.customPrefix
                                                    ? 'bg-primary/10 text-primary border-primary/20'
                                                    : 'bg-muted/50 text-muted-foreground border-border/60'
                                            }`}
                                        >
                                            {subscription?.customPrefix ? (
                                                <Sliders className="w-3 h-3 shrink-0" />
                                            ) : (
                                                <Lock className="w-3 h-3 shrink-0 text-muted-foreground/80" />
                                            )}
                                            <span>
                                                {subscription?.customPrefix
                                                    ? t.dashboard.planCard.allowed
                                                    : t.dashboard.planCard.locked}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <Link
                                href="/pricing"
                                className="flex items-center justify-center gap-1.5 w-full py-2.5 px-3 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold border border-border transition-colors mt-2"
                            >
                                <span>{t.dashboard.planCard.upgradeBtn}</span>
                                <ArrowSquareOut className="w-3.5 h-3.5" />
                            </Link>
                        </div>

                        {/* Sub-Bots Quota & Connected Bots Combined Card */}
                        <div className="p-6 rounded-3xl bg-card border border-border space-y-5 shadow-xs flex flex-col justify-between">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                        {t.dashboard.planCard.subBotsQuota}
                                    </span>
                                    <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
                                        <DeviceMobile className="w-5 h-5" weight="duotone" />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-3xl font-black text-foreground font-mono">
                                            {currentBotsCount}{' '}
                                            <span className="text-sm font-normal text-muted-foreground">
                                                / {maxBots}
                                            </span>
                                        </span>
                                        <span className="text-xs font-semibold text-muted-foreground font-mono">
                                            {Math.round((currentBotsCount / maxBots) * 100)}% {t.dashboard.usedSuffix}
                                        </span>
                                    </div>

                                    <div
                                        className="w-full h-2.5 bg-muted rounded-full overflow-hidden"
                                        role="progressbar"
                                        aria-valuenow={currentBotsCount}
                                        aria-valuemin={0}
                                        aria-valuemax={maxBots}
                                        aria-label={t.dashboard.planCard.subBotsQuota}
                                    >
                                        <div
                                            className={`h-full rounded-full transition-all duration-300 ${
                                                isBotsQuotaFull ? 'bg-amber-500' : 'bg-primary'
                                            }`}
                                            style={{ width: `${Math.min(100, (currentBotsCount / maxBots) * 100)}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                                    <span>
                                        {t.dashboard.botsSlotsLeft.replace(
                                            '{count}',
                                            String(Math.max(0, maxBots - currentBotsCount))
                                        )}
                                    </span>
                                    {isBotsQuotaFull && (
                                        <Link href="/pricing" className="text-primary font-semibold hover:underline">
                                            Upgrade →
                                        </Link>
                                    )}
                                </div>

                                {/* Connected Sub-Bots List Inside Card */}
                                <div className="pt-3 border-t border-border/80 space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-foreground font-heading">
                                            {t.dashboard.subbotsCard.title}
                                        </span>
                                        <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                                            {subBots.length}
                                        </span>
                                    </div>

                                    {subBots.length === 0 ? (
                                        <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/60 text-center">
                                            <p className="text-xs text-muted-foreground">
                                                {t.dashboard.subbotsCard.noBots}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {(isBotsExpanded ? subBots : subBots.slice(0, 4)).map((bot) => (
                                                <div
                                                    key={bot.id}
                                                    className="p-2.5 rounded-xl bg-muted/40 border border-border/60 flex items-center justify-between gap-2.5 hover:bg-muted/60 transition-colors"
                                                >
                                                    <div className="min-w-0 flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full shrink-0 bg-emerald-500" />
                                                        <div className="min-w-0">
                                                            <p className="font-mono font-semibold text-xs text-foreground truncate">
                                                                {bot.id}
                                                            </p>
                                                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                                                <span>
                                                                    Prefix:{' '}
                                                                    <code className="font-bold text-foreground">
                                                                        {bot.customPrefix || '.'}
                                                                    </code>
                                                                </span>
                                                                <span>•</span>
                                                                <span className="text-emerald-500 font-semibold">
                                                                    {bot.status}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setBotToDelete(bot.id)}
                                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer shrink-0"
                                                        title={t.dashboard.subbotsCard.deleteBtn}
                                                        aria-label={t.dashboard.subbotsCard.deleteBtn}
                                                    >
                                                        <Trash className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            ))}

                                            {/* Expand / Collapse Button if > 4 Sub-Bots */}
                                            {subBots.length > 4 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsBotsExpanded((prev) => !prev)}
                                                    className="w-full py-1.5 px-2 rounded-xl text-xs font-semibold text-primary hover:bg-primary/10 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                                                >
                                                    {isBotsExpanded ? (
                                                        <>
                                                            <span>{t.dashboard.subbotsCard.collapseBtn || 'Collapse'}</span>
                                                            <CaretUp className="w-3.5 h-3.5" />
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span>
                                                                {(t.dashboard.subbotsCard.expandBtn || 'View All ({count})').replace(
                                                                    '{count}',
                                                                    String(subBots.length)
                                                                )}
                                                            </span>
                                                            <CaretDown className="w-3.5 h-3.5" />
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowPairModal(true)}
                                disabled={isBotsQuotaFull}
                                className="flex items-center justify-center gap-1.5 w-full py-2.5 px-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-all disabled:opacity-50 cursor-pointer mt-2"
                            >
                                <Plus className="w-3.5 h-3.5" weight="bold" />
                                <span>{t.dashboard.subbotsCard.pairBtn}</span>
                            </button>
                        </div>

                        {/* Whitelist Groups Quota & Group List Combined Card */}
                        <div className="p-6 rounded-3xl bg-card border border-border space-y-5 shadow-xs flex flex-col justify-between">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                        {t.dashboard.planCard.groupsQuota}
                                    </span>
                                    <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600">
                                        <UsersThree className="w-5 h-5" weight="duotone" />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-3xl font-black text-foreground font-mono">
                                            {currentGroupsCount}{' '}
                                            <span className="text-sm font-normal text-muted-foreground">
                                                / {maxGroups}
                                            </span>
                                        </span>
                                        <span className="text-xs font-semibold text-muted-foreground font-mono">
                                            {Math.round((currentGroupsCount / maxGroups) * 100)}%{' '}
                                            {t.dashboard.usedSuffix}
                                        </span>
                                    </div>

                                    <div
                                        className="w-full h-2.5 bg-muted rounded-full overflow-hidden"
                                        role="progressbar"
                                        aria-valuenow={currentGroupsCount}
                                        aria-valuemin={0}
                                        aria-valuemax={maxGroups}
                                        aria-label={t.dashboard.planCard.groupsQuota}
                                    >
                                        <div
                                            className={`h-full rounded-full transition-all duration-300 ${
                                                isGroupsQuotaFull ? 'bg-amber-500' : 'bg-indigo-500'
                                            }`}
                                            style={{
                                                width: `${Math.min(100, (currentGroupsCount / maxGroups) * 100)}%`
                                            }}
                                        />
                                    </div>
                                </div>

                                <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                                    <span>
                                        {t.dashboard.groupsSlotsLeft.replace(
                                            '{count}',
                                            String(Math.max(0, maxGroups - currentGroupsCount))
                                        )}
                                    </span>
                                    {isGroupsQuotaFull && (
                                        <Link href="/pricing" className="text-primary font-semibold hover:underline">
                                            Upgrade →
                                        </Link>
                                    )}
                                </div>

                                {/* Whitelisted Groups List Inside Card */}
                                <div className="pt-3 border-t border-border/80 space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-foreground font-heading">
                                            {t.dashboard.groupsCard.title}
                                        </span>
                                        <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                                            {groups.length}
                                        </span>
                                    </div>

                                    {groups.length === 0 ? (
                                        <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/60 text-center">
                                            <p className="text-xs text-muted-foreground">
                                                {t.dashboard.groupsCard.noGroups}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {(isGroupsExpanded ? groups : groups.slice(0, 4)).map((grp) => {
                                                const groupSubject = groupNameMap.get(grp.jid);
                                                const pictureUrl = groupPictureMap.get(grp.jid);
                                                return (
                                                    <div
                                                        key={grp.jid}
                                                        className="p-2.5 rounded-xl bg-muted/40 border border-border/60 flex items-center justify-between gap-2.5 hover:bg-muted/60 transition-colors"
                                                    >
                                                        <div className="min-w-0 flex items-center gap-2.5">
                                                            <GroupAvatar
                                                                name={groupSubject}
                                                                pictureUrl={pictureUrl}
                                                                size="sm"
                                                            />
                                                            <div className="min-w-0">
                                                                <p className="font-semibold text-xs text-foreground truncate">
                                                                    {groupSubject || grp.jid}
                                                                </p>
                                                                {groupSubject && (
                                                                    <p className="font-mono text-[10px] text-muted-foreground truncate">
                                                                        {grp.jid}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setGroupToDelete(grp.jid)}
                                                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer shrink-0"
                                                            title={t.dashboard.groupsCard.deleteBtn}
                                                            aria-label={t.dashboard.groupsCard.deleteBtn}
                                                        >
                                                            <Trash className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                );
                                            })}

                                            {/* Expand / Collapse Button if > 4 Groups */}
                                            {groups.length > 4 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsGroupsExpanded((prev) => !prev)}
                                                    className="w-full py-1.5 px-2 rounded-xl text-xs font-semibold text-primary hover:bg-primary/10 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                                                >
                                                    {isGroupsExpanded ? (
                                                        <>
                                                            <span>{t.dashboard.groupsCard.collapseBtn || 'Collapse'}</span>
                                                            <CaretUp className="w-3.5 h-3.5" />
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span>
                                                                {(t.dashboard.groupsCard.expandBtn || 'View All ({count})').replace(
                                                                    '{count}',
                                                                    String(groups.length)
                                                                )}
                                                            </span>
                                                            <CaretDown className="w-3.5 h-3.5" />
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={handleOpenAddGroupModal}
                                disabled={isGroupsQuotaFull}
                                className="flex items-center justify-center gap-1.5 w-full py-2.5 px-3 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold border border-border transition-colors cursor-pointer mt-2 disabled:opacity-50"
                            >
                                <Plus className="w-3.5 h-3.5" weight="bold" />
                                <span>{t.dashboard.groupsCard.addBtn}</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Pairing Modal */}
                {showPairModal && (
                    <PairingModal onClose={() => setShowPairModal(false)} onSuccess={() => reloadDashboardData()} />
                )}

                {/* Add Whitelist Group Modal */}
                {showAddGroupModal && (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={t.dashboard.groupsCard.accountGroupsTitle}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-200"
                    >
                        <div className="w-full max-w-xl max-h-[90vh] rounded-3xl bg-card p-6 md:p-8 shadow-2xl border border-border flex flex-col gap-4 overflow-hidden">
                            {/* Modal Header */}
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                    <h3 className="text-xl font-bold font-heading text-foreground">
                                        {t.dashboard.groupsCard.accountGroupsTitle}
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        {t.dashboard.groupsCard.accountGroupsSubtitle}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={loadAccountGroups}
                                    disabled={isLoadingAccountGroups}
                                    title={t.dashboard.groupsCard.refreshGroups}
                                    className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                    <ArrowsClockwise
                                        className={`w-4 h-4 ${isLoadingAccountGroups ? 'animate-spin' : ''}`}
                                    />
                                </button>
                            </div>

                            {/* Search Filter Bar */}
                            <div className="relative">
                                <MagnifyingGlass className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={groupSearchQuery}
                                    onChange={(e) => setGroupSearchQuery(e.target.value)}
                                    placeholder={t.dashboard.groupsCard.searchPlaceholder}
                                    className="w-full pl-10 pr-4 py-2 rounded-xl border border-border bg-background text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                />
                            </div>

                            {/* Bot Presence Notice */}
                            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-primary/5 border border-primary/15 text-[11px] leading-relaxed text-muted-foreground">
                                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" weight="bold" />
                                <span>{t.dashboard.groupsCard.botInviteNotice}</span>
                            </div>

                            {/* Group List Body (Scrollable) */}
                            <div className="flex-1 overflow-y-auto space-y-2.5 max-h-64 pr-1">
                                {isLoadingAccountGroups ? (
                                    <div className="space-y-2 py-4">
                                        <Skeleton className="h-14 rounded-2xl w-full" />
                                        <Skeleton className="h-14 rounded-2xl w-full" />
                                        <Skeleton className="h-14 rounded-2xl w-full" />
                                    </div>
                                ) : (
                                    (() => {
                                        const filtered = participatingGroups.filter((grp) => {
                                            if (!groupSearchQuery.trim()) return true;
                                            const query = groupSearchQuery.toLowerCase();
                                            return (
                                                grp.subject?.toLowerCase().includes(query) ||
                                                grp.id.toLowerCase().includes(query)
                                            );
                                        });

                                        if (filtered.length === 0) {
                                            return (
                                                <div className="p-6 rounded-2xl border border-dashed border-border text-center space-y-2 my-2">
                                                    <UsersThree className="w-8 h-8 text-muted-foreground/60 mx-auto" />
                                                    <p className="text-sm font-semibold text-foreground">
                                                        {t.dashboard.groupsCard.noAccountGroupsFound}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                                                        {t.dashboard.groupsCard.noAccountGroupsHint}
                                                    </p>
                                                </div>
                                            );
                                        }

                                        return filtered.map((grp) => {
                                            const isAlreadyWhitelisted =
                                                grp.isWhitelisted || groups.some((g) => g.jid === grp.id);
                                            const isThisAdding = addingGroupJid === grp.id;

                                            return (
                                                <div
                                                    key={grp.id}
                                                    className="p-3 rounded-2xl border border-border/70 bg-muted/20 hover:bg-muted/40 transition-colors flex items-center justify-between gap-3"
                                                >
                                                    <div className="min-w-0 flex items-center gap-3">
                                                        <GroupAvatar name={grp.subject} pictureUrl={grp.pictureUrl} />
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <p className="text-xs sm:text-sm font-semibold text-foreground truncate max-w-[180px] sm:max-w-[240px]">
                                                                    {grp.subject}
                                                                </p>
                                                                {grp.isAdmin ? (
                                                                    <span className="px-1.5 py-0.2 text-[9px] font-bold uppercase rounded bg-primary/15 text-primary">
                                                                        {t.dashboard.groupsCard.adminBadge}
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-1.5 py-0.2 text-[9px] font-medium uppercase rounded bg-muted/80 text-muted-foreground border border-border/40">
                                                                        {t.dashboard.groupsCard.memberBadge}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-[11px] text-muted-foreground truncate font-mono">
                                                                {grp.size > 0 &&
                                                                    `${t.dashboard.groupsCard.membersCount.replace('{count}', String(grp.size))} • `}
                                                                {grp.id}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="shrink-0">
                                                        {isAlreadyWhitelisted ? (
                                                            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold border border-emerald-500/20">
                                                                <Check className="w-3.5 h-3.5" weight="bold" />
                                                                <span>{t.dashboard.groupsCard.alreadyWhitelisted}</span>
                                                            </span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                disabled={isGroupsQuotaFull || isThisAdding}
                                                                onClick={() => handleAddGroupDirect(grp.id)}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-xs hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
                                                            >
                                                                {isThisAdding ? (
                                                                    <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                                                                ) : (
                                                                    <Plus className="w-3.5 h-3.5" weight="bold" />
                                                                )}
                                                                <span>{t.dashboard.groupsCard.addToWhitelist}</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        });
                                    })()
                                )}
                            </div>

                            {/* Manual JID Collapsible */}
                            <div className="border-t border-border pt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowManualJidInput((prev) => !prev)}
                                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium cursor-pointer transition-colors"
                                >
                                    {showManualJidInput ? (
                                        <CaretUp className="w-3.5 h-3.5" />
                                    ) : (
                                        <CaretDown className="w-3.5 h-3.5" />
                                    )}
                                    <span>{t.dashboard.groupsCard.manualJidToggle}</span>
                                </button>

                                {showManualJidInput && (
                                    <form onSubmit={handleAddGroupSubmit} className="mt-3 space-y-3">
                                        <Field
                                            label={t.dashboard.groupsCard.jidInputLabel}
                                            htmlFor="group-jid"
                                            required
                                            error={addGroupError}
                                            hint={t.dashboard.groupsCard.jidHelp}
                                        >
                                            <input
                                                id="group-jid"
                                                type="text"
                                                required
                                                value={newGroupJid}
                                                onChange={(e) => {
                                                    setNewGroupJid(e.target.value);
                                                    if (addGroupError) setAddGroupError(null);
                                                }}
                                                placeholder={t.dashboard.groupsCard.jidPlaceholder}
                                                className="w-full px-4 py-2 rounded-xl border border-border bg-background text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                                            />
                                        </Field>
                                        <button
                                            type="submit"
                                            disabled={isAddingGroup || !newGroupJid.trim() || isGroupsQuotaFull}
                                            className="w-full py-2 rounded-xl bg-secondary text-secondary-foreground text-xs font-semibold hover:bg-secondary/80 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                                        >
                                            {isAddingGroup && <CircleNotch className="w-3.5 h-3.5 animate-spin" />}
                                            <span>{t.dashboard.groupsCard.submitAdd}</span>
                                        </button>
                                    </form>
                                )}
                            </div>

                            {/* Quota Indicator & Bottom Quota Reached Notification */}
                            <div className="space-y-2 border-t border-border pt-3">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>
                                        {t.dashboard.groupsCard.quotaUsageText
                                            .replace('{current}', String(currentGroupsCount))
                                            .replace('{max}', String(maxGroups))
                                            .replace('{tier}', subscription?.tier || 'FREE')}
                                    </span>
                                    <span className="font-semibold text-foreground">
                                        {Math.round((currentGroupsCount / maxGroups) * 100)}%
                                    </span>
                                </div>

                                {isGroupsQuotaFull && (
                                    <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-2.5 text-xs text-amber-700 dark:text-amber-300">
                                        <WarningCircle
                                            className="w-4 h-4 text-amber-500 shrink-0 mt-0.5"
                                            weight="fill"
                                        />
                                        <p className="font-medium">{t.dashboard.groupsCard.quotaReachedNotice}</p>
                                    </div>
                                )}

                                {addGroupError && !showManualJidInput && (
                                    <div className="p-3 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-start gap-2.5 text-xs text-destructive">
                                        <WarningCircle
                                            className="w-4 h-4 text-destructive shrink-0 mt-0.5"
                                            weight="fill"
                                        />
                                        <p className="font-medium">{addGroupError}</p>
                                    </div>
                                )}
                            </div>

                            {/* Modal Close Button */}
                            <div className="flex items-center justify-end pt-2 border-t border-border">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowAddGroupModal(false);
                                        setAddGroupError(null);
                                    }}
                                    className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer rounded-xl hover:bg-muted/30"
                                >
                                    {t.dashboard.groupsCard.cancelAdd}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Disconnect Sub-Bot Confirm Dialog */}
                <ConfirmDialog
                    isOpen={!!botToDelete}
                    onClose={() => setBotToDelete(null)}
                    onConfirm={confirmDeleteSubBot}
                    title={t.dashboard.confirmDeleteBotTitle}
                    description={t.dashboard.confirmDeleteBotDesc}
                    confirmLabel={t.dashboard.confirmBtn}
                    cancelLabel={t.dashboard.cancelBtn}
                    isDestructive={true}
                    isLoading={isDeleting}
                />

                {/* Remove Group Whitelist Confirm Dialog */}
                <ConfirmDialog
                    isOpen={!!groupToDelete}
                    onClose={() => setGroupToDelete(null)}
                    onConfirm={confirmDeleteGroup}
                    title={t.dashboard.confirmDeleteGroupTitle}
                    description={t.dashboard.confirmDeleteGroupDesc}
                    confirmLabel={t.dashboard.confirmBtn}
                    cancelLabel={t.dashboard.cancelBtn}
                    isDestructive={true}
                    isLoading={isDeleting}
                />
            </Container>
        </div>
    );
}
