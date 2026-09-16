'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DeviceMobile,
  UsersThree,
  Trash,
  Plus,
  ShieldCheck,
  Lightning,
  ArrowSquareOut,
  CircleNotch,
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import {
  getStoredToken,
  getSubscriptionStatus,
  listSubBots,
  deleteSubBot,
  listGroups,
  addGroup,
  deleteGroup,
} from '@/lib/api';
import type {
  SubscriptionStatusResponse,
  SubBotInstance,
  WhitelistedGroup,
} from '@/lib/types';
import { PairingModal } from '@/components/PairingModal';

export default function DashboardPage() {
  const { t } = useTranslation();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionStatusResponse | null>(null);
  const [subBots, setSubBots] = useState<SubBotInstance[]>([]);
  const [groups, setGroups] = useState<WhitelistedGroup[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pairing Modal state
  const [showPairModal, setShowPairModal] = useState(false);

  // Add Group state
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [newGroupJid, setNewGroupJid] = useState('');
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [addGroupError, setAddGroupError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const reloadDashboardData = useCallback(() => {
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

      try {
        const [subData, botsData, groupsData] = await Promise.all([
          getSubscriptionStatus().catch(() => ({
            tier: 'FREE' as const,
            status: 'ACTIVE' as const,
            maxSubBots: 2,
            maxGroups: 5,
            customPrefix: false,
            startedAt: new Date().toISOString(),
            expiresAt: null,
            currentSubBots: 0,
            currentGroups: 0,
          })),
          listSubBots().catch(() => []),
          listGroups().catch(() => []),
        ]);

        if (isMounted) {
          setSubscription(subData);
          setSubBots(botsData);
          setGroups(groupsData);
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

  const handleDeleteSubBot = async (phone: string) => {
    if (!confirm(t.dashboard.subbotsCard.confirmDelete)) return;
    try {
      await deleteSubBot(phone);
      setSubBots((prev) => prev.filter((b) => b.id !== phone));
      if (subscription) {
        setSubscription({
          ...subscription,
          currentSubBots: Math.max(0, subscription.currentSubBots - 1),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.common.error;
      alert(msg);
    }
  };

  const handleAddGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupJid.trim()) return;

    setIsAddingGroup(true);
    setAddGroupError(null);

    try {
      const created = await addGroup({ jid: newGroupJid.trim() });
      setGroups((prev) => [...prev, created]);
      if (subscription) {
        setSubscription({
          ...subscription,
          currentGroups: subscription.currentGroups + 1,
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

  const handleDeleteGroup = async (jid: string) => {
    if (!confirm(t.dashboard.groupsCard.confirmDeleteGroup)) return;
    try {
      await deleteGroup(jid);
      setGroups((prev) => prev.filter((g) => g.jid !== jid));
      if (subscription) {
        setSubscription({
          ...subscription,
          currentGroups: Math.max(0, subscription.currentGroups - 1),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.common.error;
      alert(msg);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <CircleNotch className="w-8 h-8 animate-spin text-primary" />
          <span className="text-xs font-semibold text-muted-foreground">{t.auth.loading}</span>
        </div>
      </div>
    );
  }

  const currentBotsCount = subBots.length;
  const maxBots = subscription?.maxSubBots || 2;
  const currentGroupsCount = groups.length;
  const maxGroups = subscription?.maxGroups || 5;

  return (
    <div className="flex flex-col w-full py-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-card via-card to-muted border border-border shadow-sm">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
              Portal Overview
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" weight="bold" />
              <span>{t.dashboard.whitelistActive}</span>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground font-heading">
            {t.dashboard.welcome} Portal Member
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Kelola sub-bot multi-device, pantau kuota paket, dan atur perizinan grup WhatsApp Anda.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setShowPairModal(true)}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs sm:text-sm font-semibold shadow-md transition-all"
          >
            <DeviceMobile className="w-4 h-4" />
            <span>{t.dashboard.subbotsCard.pairBtn}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20">
          {errorMsg}
        </div>
      )}

      {/* Subscription & Quota Overview Grid */}
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
              <span className="text-3xl font-black text-foreground">
                {subscription?.tier || 'FREE'}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-semibold">
                {subscription?.status || 'ACTIVE'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {subscription?.expiresAt
                ? `Berlaku hingga: ${new Date(subscription.expiresAt).toLocaleDateString('id-ID')}`
                : t.dashboard.planCard.perpetual}
            </p>
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t.dashboard.planCard.prefixFeature}</span>
            <span className="font-semibold text-foreground">
              {subscription?.customPrefix ? t.dashboard.planCard.allowed : t.dashboard.planCard.locked}
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
              <span className="text-3xl font-black text-foreground">
                {currentBotsCount} <span className="text-sm font-normal text-muted-foreground">/ {maxBots}</span>
              </span>
              <span className="text-xs font-semibold text-muted-foreground">
                {Math.round((currentBotsCount / maxBots) * 100)}% Terpakai
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (currentBotsCount / maxBots) * 100)}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground pt-2 border-t border-border">
            Tersedia {Math.max(0, maxBots - currentBotsCount)} slot sub-bot lagi pada paket Anda.
          </p>
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
              <span className="text-3xl font-black text-foreground">
                {currentGroupsCount} <span className="text-sm font-normal text-muted-foreground">/ {maxGroups}</span>
              </span>
              <span className="text-xs font-semibold text-muted-foreground">
                {Math.round((currentGroupsCount / maxGroups) * 100)}% Terpakai
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (currentGroupsCount / maxGroups) * 100)}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground pt-2 border-t border-border">
            Tersedia {Math.max(0, maxGroups - currentGroupsCount)} slot whitelist grup lagi.
          </p>
        </div>
      </div>

      {/* Sub-Bots List Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold font-heading text-foreground">
              {t.dashboard.subbotsCard.title}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t.dashboard.subbotsCard.subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowPairModal(true)}
            disabled={currentBotsCount >= maxBots}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold border border-border transition-colors disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" weight="bold" />
            <span>{t.dashboard.subbotsCard.pairBtn}</span>
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
          {subBots.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-muted text-muted-foreground mx-auto flex items-center justify-center">
                <DeviceMobile className="w-6 h-6" />
              </div>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {t.dashboard.subbotsCard.noBots}
              </p>
              <button
                type="button"
                onClick={() => setShowPairModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.dashboard.subbotsCard.pairBtn}</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                    <th className="p-4">{t.dashboard.subbotsCard.phoneCol}</th>
                    <th className="p-4">{t.dashboard.subbotsCard.prefixCol}</th>
                    <th className="p-4">{t.dashboard.subbotsCard.statusCol}</th>
                    <th className="p-4">{t.dashboard.subbotsCard.createdCol}</th>
                    <th className="p-4 text-right">{t.dashboard.subbotsCard.actionsCol}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {subBots.map((bot) => (
                    <tr key={bot.id} className="hover:bg-muted/20 transition-colors">
                      <td className="p-4 font-mono font-medium text-foreground">
                        {bot.id}
                      </td>
                      <td className="p-4 font-mono font-bold text-foreground">
                        <code className="px-2 py-0.5 rounded bg-muted border border-border">
                          {bot.customPrefix || '.'}
                        </code>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            bot.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : 'bg-zinc-500/10 text-zinc-600'
                          }`}
                        >
                          {bot.status === 'ACTIVE'
                            ? t.dashboard.subbotsCard.statusActive
                            : bot.status === 'PAUSED'
                            ? t.dashboard.subbotsCard.statusPaused
                            : t.dashboard.subbotsCard.statusDisconnected}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-muted-foreground">
                        {new Date(bot.createdAt).toLocaleDateString('id-ID')}
                      </td>
                      <td className="p-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteSubBot(bot.id)}
                          className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title={t.dashboard.subbotsCard.deleteBtn}
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Whitelisted Groups Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold font-heading text-foreground">
              {t.dashboard.groupsCard.title}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t.dashboard.groupsCard.subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAddGroupModal(true)}
            disabled={currentGroupsCount >= maxGroups}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold border border-border transition-colors disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" weight="bold" />
            <span>{t.dashboard.groupsCard.addBtn}</span>
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
          {groups.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-muted text-muted-foreground mx-auto flex items-center justify-center">
                <UsersThree className="w-6 h-6" />
              </div>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {t.dashboard.groupsCard.noGroups}
              </p>
              <button
                type="button"
                onClick={() => setShowAddGroupModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-xs font-semibold border border-border shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.dashboard.groupsCard.addBtn}</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                    <th className="p-4">{t.dashboard.groupsCard.jidCol}</th>
                    <th className="p-4">{t.dashboard.groupsCard.addedCol}</th>
                    <th className="p-4 text-right">{t.dashboard.groupsCard.actionCol}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groups.map((grp) => (
                    <tr key={grp.jid} className="hover:bg-muted/20 transition-colors">
                      <td className="p-4 font-mono font-medium text-foreground">
                        {grp.jid}
                      </td>
                      <td className="p-4 text-xs text-muted-foreground">
                        {new Date(grp.createdAt).toLocaleDateString('id-ID')}
                      </td>
                      <td className="p-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(grp.jid)}
                          className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title={t.dashboard.groupsCard.deleteBtn}
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Pairing Modal */}
      {showPairModal && (
        <PairingModal
          onClose={() => setShowPairModal(false)}
          onSuccess={() => reloadDashboardData()}
        />
      )}

      {/* Add Whitelist Group Modal */}
      {showAddGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 md:p-8 shadow-2xl border border-border flex flex-col gap-5">
            <div className="space-y-1">
              <h3 className="text-xl font-bold font-heading text-foreground">
                {t.dashboard.groupsCard.addModalTitle}
              </h3>
              <p className="text-xs text-muted-foreground">
                Masukkan Group JID WhatsApp yang ingin diizinkan merespon bot.
              </p>
            </div>

            <form onSubmit={handleAddGroupSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="group-jid" className="text-xs font-semibold text-foreground">
                  {t.dashboard.groupsCard.jidInputLabel}
                </label>
                <input
                  id="group-jid"
                  type="text"
                  required
                  value={newGroupJid}
                  onChange={(e) => setNewGroupJid(e.target.value)}
                  placeholder={t.dashboard.groupsCard.jidPlaceholder}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <span className="text-[11px] text-muted-foreground">
                  {t.dashboard.groupsCard.jidHelp}
                </span>
              </div>

              {addGroupError && (
                <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-xs font-medium border border-destructive/20">
                  {addGroupError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddGroupModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  {t.dashboard.groupsCard.cancelAdd}
                </button>
                <button
                  type="submit"
                  disabled={isAddingGroup || !newGroupJid.trim()}
                  className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-xs hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isAddingGroup && <CircleNotch className="w-3.5 h-3.5 animate-spin" />}
                  <span>{t.dashboard.groupsCard.submitAdd}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
