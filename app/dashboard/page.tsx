'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    DeviceMobile,
    UsersThree,
    Trash,
    Plus,
    Lightning,
    ArrowSquareOut,
    CircleNotch,
    CheckCircle,
    WarningCircle,
    User,
    Wallet,
    ChartBar
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import {
    getStoredToken,
    getStoredUser,
    getUserProfile,
    getSubscriptionStatus,
    listSubBots,
    deleteSubBot,
    listGroups,
    addGroup,
    deleteGroup
} from '@/lib/api';
import type { SubscriptionStatusResponse, SubBotInstance, WhitelistedGroup, UserProfile } from '@/lib/types';
import { formatRupiah } from '@/lib/currency';
import { PairingModal } from '@/components/PairingModal';
import { Container } from '@/components/ui/container';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';

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

    // Pairing Modal state
    const [showPairModal, setShowPairModal] = useState(false);

    // Add Group state
    const [showAddGroupModal, setShowAddGroupModal] = useState(false);
    const [newGroupJid, setNewGroupJid] = useState('');
    const [isAddingGroup, setIsAddingGroup] = useState(false);
    const [addGroupError, setAddGroupError] = useState<string | null>(null);
    const [refreshCount, setRefreshCount] = useState(0);

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
                const [subData, botsData, groupsData, profileRes] = await Promise.all([
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
                    getUserProfile().catch(() => null)
                ]);

                if (isMounted) {
                    setSubscription(subData);
                    setSubBots(botsData);
                    setGroups(groupsData);
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

    const handleAddGroupSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const cleanJid = newGroupJid.trim();
        if (!cleanJid) return;

        if (!cleanJid.endsWith('@g.us')) {
            setAddGroupError(t.dashboard.invalidGroupJid);
            return;
        }

        setIsAddingGroup(true);
        setAddGroupError(null);

        try {
            const created = await addGroup({ jid: cleanJid });
            setGroups((prev) => [...prev, created]);
            if (subscription) {
                setSubscription({
                    ...subscription,
                    currentGroups: subscription.currentGroups + 1
                });
            }
            setNewGroupJid('');
            setShowAddGroupModal(false);
        } catch (err: unknown) {
            const errorObj = err as { data?: { code?: string }; status?: number; message?: string };
            if (errorObj.data?.code === 'QUOTA_EXCEEDED_GROUPS' || errorObj.status === 403) {
                setAddGroupError(t.dashboard.groupsCard.quotaFull);
            } else {
                const msg = err instanceof Error ? err.message : t.common.error;
                setAddGroupError(msg);
            }
        } finally {
            setIsAddingGroup(false);
        }
    };

    const currentBotsCount = subBots.length;
    const maxBots = subscription?.maxSubBots || 2;
    const isBotsQuotaFull = currentBotsCount >= maxBots;

    const currentGroupsCount = groups.length;
    const maxGroups = subscription?.maxGroups || 5;
    const isGroupsQuotaFull = currentGroupsCount >= maxGroups;

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
                    <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">{t.dashboard.headerSubtitle}</p>
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
                        {/* Plan Card */}
                        <div className="p-6 rounded-3xl bg-card border border-border space-y-4 shadow-xs">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    {t.dashboard.planCard.title}
                                </span>
                                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                                    <Lightning className="w-5 h-5" weight="fill" />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-black text-foreground font-heading">
                                        {subscription?.tier || 'FREE'}
                                    </span>
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">
                                        {subscription?.status || 'ACTIVE'}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {subscription?.expiresAt
                                        ? `${t.dashboard.validUntilPrefix} ${new Date(subscription.expiresAt).toLocaleDateString(dateLocale)}`
                                        : t.dashboard.planCard.perpetual}
                                </p>
                            </div>

                            <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">{t.dashboard.planCard.prefixFeature}</span>
                                <span className="font-semibold text-foreground">
                                    {subscription?.customPrefix
                                        ? t.dashboard.planCard.allowed
                                        : t.dashboard.planCard.locked}
                                </span>
                            </div>

                            <Link
                                href="/pricing"
                                className="flex items-center justify-center gap-1.5 w-full py-2.5 px-3 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold border border-border transition-colors"
                            >
                                <span>{t.dashboard.planCard.upgradeBtn}</span>
                                <ArrowSquareOut className="w-3.5 h-3.5" />
                            </Link>
                        </div>

                        {/* Sub-Bots Quota Card */}
                        <div className="p-6 rounded-3xl bg-card border border-border space-y-4 shadow-xs">
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
                                        <span className="text-sm font-normal text-muted-foreground">/ {maxBots}</span>
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
                        </div>

                        {/* Groups Quota Card */}
                        <div className="p-6 rounded-3xl bg-card border border-border space-y-4 shadow-xs">
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
                                        <span className="text-sm font-normal text-muted-foreground">/ {maxGroups}</span>
                                    </span>
                                    <span className="text-xs font-semibold text-muted-foreground font-mono">
                                        {Math.round((currentGroupsCount / maxGroups) * 100)}% {t.dashboard.usedSuffix}
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
                                        style={{ width: `${Math.min(100, (currentGroupsCount / maxGroups) * 100)}%` }}
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
                        </div>
                    </div>
                )}

                {/* Sub-Bots List Section */}
                <section className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold font-heading text-foreground">
                                {t.dashboard.subbotsCard.title}
                            </h2>
                            <p className="text-xs text-muted-foreground">{t.dashboard.subbotsCard.subtitle}</p>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowPairModal(true)}
                            disabled={isBotsQuotaFull}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5" weight="bold" />
                            <span>{t.dashboard.subbotsCard.pairBtn}</span>
                        </button>
                    </div>

                    {isLoading ? (
                        <Skeleton className="h-40 rounded-2xl" />
                    ) : subBots.length === 0 ? (
                        <EmptyState
                            icon={<DeviceMobile className="w-6 h-6" />}
                            title={t.dashboard.subbotsCard.noBots}
                            description={t.dashboard.subbotsCard.noBotsDesc}
                            action={
                                <button
                                    type="button"
                                    onClick={() => setShowPairModal(true)}
                                    disabled={isBotsQuotaFull}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-xs hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>{t.dashboard.subbotsCard.pairBtn}</span>
                                </button>
                            }
                        />
                    ) : (
                        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
                            {/* Desktop Table View */}
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                                    <thead>
                                        <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                                            <th scope="col" className="p-4">
                                                {t.dashboard.subbotsCard.phoneCol}
                                            </th>
                                            <th scope="col" className="p-4">
                                                {t.dashboard.subbotsCard.prefixCol}
                                            </th>
                                            <th scope="col" className="p-4">
                                                {t.dashboard.subbotsCard.statusCol}
                                            </th>
                                            <th scope="col" className="p-4">
                                                {t.dashboard.subbotsCard.createdCol}
                                            </th>
                                            <th scope="col" className="p-4 text-right">
                                                {t.dashboard.subbotsCard.actionsCol}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {subBots.map((bot) => (
                                            <tr key={bot.id} className="hover:bg-muted/20 transition-colors">
                                                <td className="p-4 font-mono font-semibold text-foreground">
                                                    {bot.id}
                                                </td>
                                                <td className="p-4 font-mono font-bold text-foreground">
                                                    <code className="px-2 py-0.5 rounded bg-muted border border-border">
                                                        {bot.customPrefix || '.'}
                                                    </code>
                                                </td>
                                                <td className="p-4">
                                                    <span
                                                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                                            bot.status === 'ACTIVE'
                                                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                                : 'bg-zinc-500/10 text-zinc-500'
                                                        }`}
                                                    >
                                                        <span
                                                            className={`w-1.5 h-1.5 rounded-full ${
                                                                bot.status === 'ACTIVE'
                                                                    ? 'bg-emerald-500'
                                                                    : 'bg-zinc-400'
                                                            }`}
                                                        />
                                                        <span>
                                                            {bot.status === 'ACTIVE'
                                                                ? t.dashboard.subbotsCard.statusActive
                                                                : bot.status === 'PAUSED'
                                                                  ? t.dashboard.subbotsCard.statusPaused
                                                                  : t.dashboard.subbotsCard.statusDisconnected}
                                                        </span>
                                                    </span>
                                                </td>
                                                <td className="p-4 text-xs text-muted-foreground">
                                                    {new Date(bot.createdAt).toLocaleDateString(dateLocale)}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => setBotToDelete(bot.id)}
                                                        className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                                                        title={t.dashboard.subbotsCard.deleteBtn}
                                                        aria-label={t.dashboard.subbotsCard.deleteBtn}
                                                    >
                                                        <Trash className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Card List View */}
                            <div className="sm:hidden divide-y divide-border">
                                {subBots.map((bot) => (
                                    <div key={bot.id} className="p-4 space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono font-bold text-foreground text-sm">
                                                {bot.id}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setBotToDelete(bot.id)}
                                                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                                                aria-label={t.dashboard.subbotsCard.deleteBtn}
                                            >
                                                <Trash className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>
                                                Prefix:{' '}
                                                <code className="px-1.5 py-0.5 rounded bg-muted font-mono">
                                                    {bot.customPrefix || '.'}
                                                </code>
                                            </span>
                                            <span className="text-emerald-500 font-semibold">{bot.status}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                {/* Whitelisted Groups Section */}
                <section className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold font-heading text-foreground">
                                {t.dashboard.groupsCard.title}
                            </h2>
                            <p className="text-xs text-muted-foreground">{t.dashboard.groupsCard.subtitle}</p>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowAddGroupModal(true)}
                            disabled={isGroupsQuotaFull}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold border border-border transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5" weight="bold" />
                            <span>{t.dashboard.groupsCard.addBtn}</span>
                        </button>
                    </div>

                    {isLoading ? (
                        <Skeleton className="h-40 rounded-2xl" />
                    ) : groups.length === 0 ? (
                        <EmptyState
                            icon={<UsersThree className="w-6 h-6" />}
                            title={t.dashboard.groupsCard.noGroups}
                            description={t.dashboard.groupsCard.noGroupsDesc}
                            action={
                                <button
                                    type="button"
                                    onClick={() => setShowAddGroupModal(true)}
                                    disabled={isGroupsQuotaFull}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-xs font-semibold border border-border shadow-xs hover:bg-secondary/80 disabled:opacity-50 cursor-pointer"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>{t.dashboard.groupsCard.addBtn}</span>
                                </button>
                            }
                        />
                    ) : (
                        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
                            {/* Desktop Table View */}
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                                    <thead>
                                        <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                                            <th scope="col" className="p-4">
                                                {t.dashboard.groupsCard.jidCol}
                                            </th>
                                            <th scope="col" className="p-4">
                                                {t.dashboard.groupsCard.addedCol}
                                            </th>
                                            <th scope="col" className="p-4 text-right">
                                                {t.dashboard.groupsCard.actionCol}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {groups.map((grp) => (
                                            <tr key={grp.jid} className="hover:bg-muted/20 transition-colors">
                                                <td className="p-4 font-mono font-medium text-foreground">{grp.jid}</td>
                                                <td className="p-4 text-xs text-muted-foreground">
                                                    {new Date(grp.createdAt).toLocaleDateString(dateLocale)}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => setGroupToDelete(grp.jid)}
                                                        className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                                                        title={t.dashboard.groupsCard.deleteBtn}
                                                        aria-label={t.dashboard.groupsCard.deleteBtn}
                                                    >
                                                        <Trash className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Card List View */}
                            <div className="sm:hidden divide-y divide-border">
                                {groups.map((grp) => (
                                    <div key={grp.jid} className="p-4 flex items-center justify-between">
                                        <span className="font-mono text-xs font-medium text-foreground truncate max-w-[240px]">
                                            {grp.jid}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setGroupToDelete(grp.jid)}
                                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                                            aria-label={t.dashboard.groupsCard.deleteBtn}
                                        >
                                            <Trash className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                {/* Profile Summary Card with Formatted Balance & Credit Gauge */}
                <section className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-xs space-y-6">
                    <div className="flex items-center justify-between border-b border-border pb-4">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-primary/10 text-primary">
                                <User className="w-5 h-5" weight="bold" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold font-heading text-foreground">
                                    {t.dashboard.profileCard.title}
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    {userProfile?.id || '628xxx@s.whatsapp.net'}
                                </p>
                            </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                            <CheckCircle className="w-4 h-4" weight="fill" />
                            <span>{t.dashboard.whitelistActive}</span>
                        </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Username */}
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">
                                {t.dashboard.profileCard.username}
                            </span>
                            <p className="text-sm font-bold text-foreground font-mono truncate">
                                {userProfile?.username || userProfile?.pushName || '-'}
                            </p>
                            {userProfile?.pushName &&
                                userProfile?.username &&
                                userProfile.username !== userProfile.pushName && (
                                    <p className="text-[11px] text-muted-foreground truncate font-sans">
                                        WA: {userProfile.pushName}
                                    </p>
                                )}
                        </div>

                        {/* Email */}
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">
                                {t.dashboard.profileCard.email}
                            </span>
                            <p className="text-sm font-medium text-foreground">{userProfile?.email || '-'}</p>
                        </div>

                        {/* Formatted Rupiah Balance */}
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                <Wallet className="w-3.5 h-3.5 text-primary" />
                                {t.dashboard.profileCard.balance}
                            </span>
                            <p className="text-lg font-extrabold text-foreground font-mono">
                                {formatRupiah(Number(userProfile?.balance || 0))}
                            </p>
                        </div>

                        {/* Credit Score Gauge */}
                        <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-muted-foreground flex items-center gap-1.5">
                                    <ChartBar className="w-3.5 h-3.5 text-indigo-500" />
                                    {t.dashboard.profileCard.creditScore}
                                </span>
                                <span className="font-mono font-bold text-foreground">
                                    {userProfile?.creditScore ?? 500} / 1000
                                </span>
                            </div>
                            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-indigo-500 rounded-full transition-all"
                                    style={{
                                        width: `${Math.min(100, ((userProfile?.creditScore ?? 500) / 1000) * 100)}%`
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Pairing Modal */}
                {showPairModal && (
                    <PairingModal onClose={() => setShowPairModal(false)} onSuccess={() => reloadDashboardData()} />
                )}

                {/* Add Whitelist Group Modal */}
                {showAddGroupModal && (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={t.dashboard.groupsCard.addModalTitle}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-200"
                    >
                        <div className="w-full max-w-md rounded-3xl bg-card p-6 md:p-8 shadow-2xl border border-border flex flex-col gap-5">
                            <div className="space-y-1">
                                <h3 className="text-xl font-bold font-heading text-foreground">
                                    {t.dashboard.groupsCard.addModalTitle}
                                </h3>
                                <p className="text-xs text-muted-foreground">{t.dashboard.addGroupDesc}</p>
                            </div>

                            <form onSubmit={handleAddGroupSubmit} className="space-y-4">
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
                                        className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                </Field>

                                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowAddGroupModal(false);
                                            setAddGroupError(null);
                                        }}
                                        className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                                    >
                                        {t.dashboard.groupsCard.cancelAdd}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isAddingGroup || !newGroupJid.trim()}
                                        className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-xs hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                                    >
                                        {isAddingGroup && <CircleNotch className="w-3.5 h-3.5 animate-spin" />}
                                        <span>{t.dashboard.groupsCard.submitAdd}</span>
                                    </button>
                                </div>
                            </form>
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
