/**
 * Centralized internationalization dictionary for Cosmos Web Portal.
 * Default language: Indonesian ('id'). Supports English ('en').
 */

export type Language = 'id' | 'en';

const rawDictionary = {
    id: {
        nav: {
            brand: 'Cosmos',
            tagline: 'WhatsApp & Multi-Device Bot Platform',
            portalBadge: 'Multi-Device Portal',
            home: 'Beranda',
            howItWorks: 'Cara Kerja',
            pricing: 'Harga & Paket',
            status: 'Status Sistem',
            dashboard: 'Dashboard',
            register: 'Daftar',
            login: 'Masuk',
            logout: 'Keluar',
            language: 'Bahasa'
        },
        announcement: {
            message: 'Verifikasi terbalik anti-banned — tanpa risiko pemblokiran spam OTP',
            cta: 'Coba Sekarang →'
        },
        hero: {
            eyebrow: 'Anti-Banned Inverted Verification • Baileys Multi-Device',
            title: 'Ekosistem WhatsApp Bot Cerdas & Multi-Device Otonom',
            subtitle:
                'Hubungkan nomor WhatsApp Anda sebagai sub-bot mandiri, otomatisasi obrolan grup komunitas, dan nikmati fitur perbankan virtual dengan infrastruktur aman berkecepatan tinggi.',
            ctaRegister: 'Mulai Sekarang — Gratis',
            ctaPricing: 'Lihat Paket Langganan',
            ctaHowItWorks: 'Pelajari Cara Kerja',
            ctaTitle: 'Siap Menjalankan Bot WhatsApp Anda?',
            ctaDesc:
                'Daftarkan nomor WhatsApp sekarang melalui verifikasi aman bebas banned, dan mulai tautkan sub-bot dalam hitungan menit.',
            trustFree: '2 Sub-Bot Gratis',
            trustNoCard: 'Tanpa Kartu Kredit',
            trustPayment: 'Aktivasi Instan via WhatsApp QRIS/Bank',
            feature1Title: 'Sub-Bot Multi-Device',
            feature1Desc: 'Hubungkan nomor WhatsApp pribadi sebagai sub-bot mandiri dengan pairing code atau scan QR.',
            feature2Title: 'Verifikasi Anti-Banned',
            feature2Desc:
                'Inverted verification berbasis pesan masuk WhatsApp dari pengguna tanpa risiko pemblokiran spam.',
            feature3Title: 'Sistem Kuota & Grup',
            feature3Desc:
                'Whitelist grup WhatsApp dan kelola alokasi grup secara terpusat dengan sistem tier berkeadilan.'
        },
        howItWorks: {
            title: 'Cara Kerja Cosmos',
            subtitle: 'Mulai hubungkan bot dan kelola grup hanya dalam 3 langkah mudah.',
            step1Title: '1. Daftarkan Nomor WhatsApp',
            step1Desc:
                'Daftarkan nomor Anda secara aman menggunakan form registrasi dengan perlindungan Cloudflare Turnstile.',
            step2Title: '2. Verifikasi Tanpa Risiko Banned',
            step2Desc:
                'Kirim pesan .verify <TOKEN> dari WhatsApp Anda ke nomor bot resmi. WhatsApp mencatat interaksi sebagai obrolan organik.',
            step3Title: '3. Tautkan Sub-Bot & Whitelist Grup',
            step3Desc:
                'Gunakan 8-digit Pairing Code atau scan QR untuk mengaktifkan sub-bot mandiri dan daftarkan JID grup yang ingin dikelola.'
        },
        howItWorksPage: {
            badge: 'Panduan Onboarding',
            whyTitle: 'Mengapa Inverted Verification?',
            whyDesc:
                'Metode verifikasi kami membalikkan alur: Anda yang pertama kali mengirim pesan ke nomor bot resmi. Algoritma anti-spam WhatsApp mendeteksi pesan masuk ini sebagai obrolan inisiasi organik dari pengguna, sehingga nomor bot maupun nomor Anda terbebas dari risiko penandaan spam atau pemblokiran.',
            pairingTitle: 'Panduan Menghubungkan Sub-Bot',
            pairingDesc:
                'Melalui fitur WhatsApp Linked Devices resmi (Baileys Multi-Device), nomor Anda bertindak sebagai node independen tanpa perlu membocorkan kredensial atau password akun WhatsApp Anda.',
            readyTitle: 'Siap Menjalankan Bot WhatsApp Anda?',
            readyDesc: 'Daftar sekarang dan nikmati 2 slot sub-bot mandiri gratis selamanya.',
            ctaBtn: 'Mulai Sekarang — Gratis',
            dashboardBtn: 'Buka Dashboard'
        },
        statusPage: {
            title: 'Status Sistem & Telemetri',
            subtitle: 'Pemantauan real-time untuk ketersediaan infrastruktur, sub-bot, dan layanan Cosmos.',
            allOperational: 'Semua Sistem Beroperasi Normal',
            partialOutage: 'Sebagian Layanan Mengalami Penurunan',
            majorOutage: 'Gangguan Layanan Utama',
            operational: 'Operasional',
            degraded: 'Performa Menurun',
            outage: 'Gangguan',
            subbotsTitle: 'Sub-Bot Terhubung',
            subbotsDesc: 'Sesi sub-bot aktif yang beroperasi di jaringan',
            uptimeTitle: 'Uptime Sistem',
            uptimeDesc: 'Tingkat ketersediaan operasional tanpa henti',
            groupsTitle: 'Grup Whitelist',
            groupsDesc: 'Komunitas WhatsApp aktif yang dilindungi',
            banTitle: 'Insidensi Spam-Ban',
            banDesc: 'Pemblokiran nomor WhatsApp terkonfirmasi',
            servicesTitle: 'Kesehatan Layanan Komponen',
            servicesDesc: 'Status konektivitas dan latensi mikro-layanan inti',
            lastChecked: 'Terakhir diperiksa:',
            refreshBtn: 'Segarkan Data',
            refreshing: 'Menyinkronkan...',
            viewStatus: 'Lihat Status',
            backHome: 'Kembali ke Beranda',
            back: 'Kembali',
            slideBackHint: 'Geser ke kanan untuk kembali',
            latency: 'Latensi'
        },
        features: {
            title: 'Fitur Unggulan Cosmos',
            subtitle: 'Dirancang untuk produktivitas tim, keandalan operasional, dan perlindungan privasi nomor Anda.',
            subbots: {
                title: 'Multi-Device Sub-Bot Pairing',
                desc: 'Tautkan nomor WhatsApp Anda secara instan menggunakan 8-digit Pairing Code atau QR streaming tanpa perlu menyewa dan mengelola server sendiri.',
                badge: 'Koneksi Mandiri Tanpa Server'
            },
            security: {
                title: 'Keamanan Berlapis & Deteksi Login',
                desc: 'Proteksi Cloudflare Turnstile, pelacakan sesi aman, dan notifikasi keamanan langsung ke WhatsApp Anda jika terdeteksi aktivitas mencurigakan.',
                badge: 'Proteksi Cloudflare & Enkripsi Sesi'
            },
            whitelist: {
                title: 'Whitelist Grup & Kontrol Akses',
                desc: 'Kontrol penuh atas grup WhatsApp yang diizinkan merespon bot, mencegah penggunaan tanpa izin atau spam di luar komunitas Anda.',
                badge: 'Isolasi Tenant & Kontrol Kuota'
            },
            economy: {
                title: 'Ekonomi Virtual & Otomasi Obrolan',
                desc: 'Hidupkan interaksi komunitas dengan sistem ekonomi terpadu, pembukuan mutasi transparan, level reputasi, dan berbagai minigame interaktif.',
                badge: 'Sistem Ekonomi & Game Komunitas'
            }
        },
        pricing: {
            title: 'Pilihan Paket & Langganan',
            subtitle: 'Pilih paket yang sesuai dengan kebutuhan operasional bot dan komunitas WhatsApp Anda.',
            orderNow: 'Langganan Sekarang',
            contactSales: 'Hubungi Sales',
            periodMonth: '/ bulan',
            included: 'Fitur yang disertakan:',
            popular: 'Paling Populer',
            activePlan: 'Paket Aktif Anda',
            salesNoticeTitle: 'Alur Pembayaran Langsung via WhatsApp Sales:',
            salesNoticeStep1: '1. Klik paket langganan pilihan Anda',
            salesNoticeStep2: '2. WhatsApp otomatis terbuka dengan referensi pesanan unik',
            salesNoticeStep3: '3. Lakukan pembayaran via QRIS atau Transfer Bank',
            salesNoticeStep4: '4. Kuota bertambah instan di dashboard Anda',
            manualFlowNotice: 'Pembayaran manual langsung via WhatsApp ke Sales Rep menggunakan QRIS / Transfer Bank.',
            free: {
                name: 'Free',
                price: 'Rp0',
                desc: 'Cocok untuk pengguna personal yang ingin mencoba kemampuan bot WhatsApp.',
                features: [
                    '2 Sub-Bot aktif',
                    '5 Whitelist grup',
                    'Prefix standar (.)',
                    'Dukungan Komunitas',
                    'Akses fitur standar',
                    'Bonus Multiplier Ekonomi 1.0x'
                ],
                cta: 'Mulai Gratis'
            },
            subsidized: {
                name: 'Subsidized',
                price: 'Rp10.000',
                desc: 'Pilihan ekonomis terbaik untuk komunitas kecil dan admin grup aktif.',
                features: [
                    '5 Sub-Bot aktif',
                    '10 Whitelist grup',
                    'Prefix kustom per sub-bot',
                    'Dukungan Prioritas Medium',
                    'Fitur bot lanjutan',
                    'Bonus Multiplier Ekonomi 1.05x'
                ],
                cta: 'Pilih Subsidized'
            },
            partner: {
                name: 'Partner',
                price: 'Rp32.000',
                desc: 'Paket terlengkap untuk pengelola komunitas besar dan bisnis.',
                features: [
                    '12 Sub-Bot aktif',
                    '25 Whitelist grup',
                    'Prefix kustom per sub-bot',
                    'Dukungan Prioritas Tinggi (Direct Partner)',
                    'Early Access fitur baru',
                    'Bonus Multiplier Ekonomi 1.15x'
                ],
                cta: 'Pilih Partner'
            }
        },
        auth: {
            registerTitle: 'Pendaftaran Akun Cosmos',
            registerSubtitle: 'Daftarkan nomor WhatsApp Anda untuk membuka akses portal dan manajemen sub-bot.',
            loginTitle: 'Masuk ke Akun Anda',
            loginSubtitle: 'Masukkan nomor WhatsApp atau username dan kata sandi Anda.',
            step1Label: '1. Data Akun',
            step2Label: '2. Verifikasi WhatsApp',
            step3Label: '3. Siap Digunakan',
            phoneLabel: 'Nomor WhatsApp',
            phonePlaceholder: '628123456789',
            phoneHelp: 'Gunakan kode negara tanpa tanda plus atau awalan 0 (misal: 628...)',
            phonePreviewPrefix: 'Preview JID Akun:',
            usernameLabel: 'Username (Opsional)',
            usernamePlaceholder: 'username_anda',
            emailLabel: 'Email (Opsional)',
            emailPlaceholder: 'nama@example.com',
            passwordLabel: 'Kata Sandi',
            passwordPlaceholder: '••••••••',
            confirmPasswordLabel: 'Konfirmasi Kata Sandi',
            identifierLabel: 'Nomor WhatsApp atau Username',
            identifierPlaceholder: '628123456789 atau username',
            invertedTab: 'Verifikasi WhatsApp (Direkomendasikan)',
            directTab: 'OTP Langsung (Alternatif)',
            turnstileRequired: 'Silakan selesaikan verifikasi Cloudflare Turnstile terlebih dahulu.',
            submitRegister: 'Daftar & Verifikasi WhatsApp',
            submitRegisterDirect: 'Kirim Kode OTP ke WhatsApp',
            submitLogin: 'Masuk ke Dashboard',
            alreadyHaveAccount: 'Sudah punya akun? Masuk di sini',
            noAccount: 'Belum punya akun? Daftar sekarang',
            loading: 'Memproses...',
            orDivider: 'atau',
            invalidPhone: 'Masukkan nomor WhatsApp yang valid (minimal 10 digit).',
            passwordMinLength: 'Kata sandi minimal 6 karakter.',
            passwordMismatch: 'Konfirmasi kata sandi tidak cocok.',
            loginFailed: 'Login gagal. Periksa kembali akun dan kata sandi Anda.',
            invertedInfo:
                'Anda mengirim pesan verifikasi ke bot terlebih dahulu, sehingga WhatsApp memvalidasi interaksi sebagai pesan organik.',
            directInfo: 'Bot akan mengirimkan kode OTP 6-digit ke nomor WhatsApp Anda. Dibatasi 5 kali per 15 menit.',
            forgotPasswordHint: 'Lupa kata sandi? Hubungi tim Sales/Admin untuk reset akun.'
        },
        invertedVerify: {
            title: 'Verifikasi Kepemilikan WhatsApp',
            subtitle:
                'Kirim pesan verifikasi dari WhatsApp Anda untuk mengaktifkan akun secara instan tanpa risiko spam.',
            step1: '1. Klik tombol hijau di bawah untuk membuka WhatsApp ke Bot Cosmos.',
            step2: '2. Kirim pesan yang sudah disiapkan tanpa mengubah kodenya:',
            step3: '3. Sistem akan otomatis memverifikasi dan mengalihkan Anda ke Dashboard.',
            whatsappBtn: 'Buka WhatsApp & Kirim Verifikasi',
            tokenLabel: 'Kode Verifikasi Opaque:',
            copyBtn: 'Salin Kode',
            copied: 'Tersalin!',
            waitingWs: 'Menunggu konfirmasi verifikasi dari WhatsApp...',
            expiresIn: 'Masa berlaku kode:',
            cancel: 'Batal',
            success: 'Verifikasi Berhasil! Mengalihkan...',
            timeout: 'Masa berlaku verifikasi habis. Silakan coba lagi.'
        },
        directOtp: {
            title: 'Masukkan Kode OTP WhatsApp',
            subtitle: 'Kode verifikasi 6-digit telah dikirimkan ke nomor WhatsApp Anda.',
            otpLabel: 'Kode OTP (6 Angka)',
            otpPlaceholder: '123456',
            verifyBtn: 'Verifikasi & Masuk',
            resendBtn: 'Kirim Ulang OTP',
            resendCountdown: 'Kirim ulang dalam',
            expired: 'Kode kedaluwarsa. Silakan minta kode baru.',
            invalid: 'Kode OTP salah. Periksa kembali pesan di WhatsApp Anda.',
            expiresInLabel: 'Kedaluwarsa:',
            resending: 'Mengirim...',
            resent: 'OTP baru telah dikirimkan ke WhatsApp Anda.'
        },
        dashboard: {
            welcome: 'Selamat Datang,',
            overviewLabel: 'Portal Member',
            headerSubtitle: 'Kelola sub-bot multi-device, pantau kuota paket, dan atur perizinan grup WhatsApp Anda.',
            validUntilPrefix: 'Berlaku hingga:',
            usedSuffix: 'Terpakai',
            botsSlotsLeft: 'Tersedia {count} slot sub-bot lagi pada paket Anda.',
            groupsSlotsLeft: 'Tersedia {count} slot whitelist grup lagi.',
            addGroupDesc: 'Masukkan Group JID WhatsApp yang ingin diizinkan merespon bot.',
            whitelistActive: 'Akun Terverifikasi',
            whitelistPending: 'Menunggu Verifikasi WhatsApp',
            invalidGroupJid: 'JID grup harus berakhiran @g.us (contoh: 120363023456789@g.us)',
            confirmDeleteBotTitle: 'Putuskan Hubungan Sub-Bot',
            confirmDeleteBotDesc: 'Apakah Anda yakin ingin memutuskan sub-bot ini? Sesi koneksi WhatsApp akan ditutup.',
            confirmDeleteGroupTitle: 'Hapus Whitelist Grup',
            confirmDeleteGroupDesc: 'Apakah Anda yakin ingin menghapus izin bot untuk grup ini?',
            confirmBtn: 'Ya, Lanjutkan',
            cancelBtn: 'Batal',
            planCard: {
                title: 'Status Langganan',
                currentTier: 'Paket Saat Ini',
                status: 'Status',
                expiresAt: 'Berlaku Hingga',
                perpetual: 'Permanen (Free)',
                upgradeBtn: 'Upgrade Paket',
                subBotsQuota: 'Kuota Sub-Bot',
                groupsQuota: 'Kuota Whitelist Grup',
                prefixFeature: 'Prefix Kustom',
                allowed: 'Tersedia',
                locked: 'Terkunci (Hanya .)'
            },
            subbotsCard: {
                title: 'Sub-Bot Multi-Device Terhubung',
                subtitle: 'Kelola instance sub-bot WhatsApp yang berjalan atas nama nomor Anda.',
                pairBtn: 'Tautkan Sub-Bot Baru',
                noBots: 'Belum ada sub-bot yang terhubung.',
                noBotsDesc: 'Tautkan nomor WhatsApp Anda sebagai sub-bot mandiri menggunakan kode pairing atau QR.',
                phoneCol: 'Nomor Bot',
                prefixCol: 'Prefix',
                statusCol: 'Status',
                createdCol: 'Dibuat',
                actionsCol: 'Aksi',
                statusActive: 'Aktif',
                statusPaused: 'Dijeda',
                statusDisconnected: 'Terputus',
                startBtn: 'Mulai',
                stopBtn: 'Hentikan',
                deleteBtn: 'Putuskan',
                confirmDelete: 'Yakin ingin memutuskan sub-bot ini?'
            },
            groupsCard: {
                title: 'Grup WhatsApp Ter-Whitelist',
                subtitle: 'Daftar grup yang diizinkan merespon perintah bot Cosmos Anda.',
                addBtn: 'Tambah Grup',
                noGroups: 'Belum ada grup ter-whitelist.',
                noGroupsDesc: 'Tambahkan JID grup agar bot aktif melayani anggota di obrolan bersama.',
                jidCol: 'ID Grup (JID)',
                addedCol: 'Ditambahkan',
                actionCol: 'Aksi',
                deleteBtn: 'Hapus Whitelist',
                confirmDeleteGroup: 'Yakin ingin menghapus whitelist untuk grup ini?',
                addModalTitle: 'Tambah Whitelist Grup Baru',
                jidInputLabel: 'JID Grup WhatsApp',
                jidPlaceholder: '120363023456789@g.us',
                jidHelp: 'Dapatkan JID grup melalui bot dengan mengetik .getjid di dalam grup Anda.',
                submitAdd: 'Simpan ke Whitelist',
                cancelAdd: 'Batal',
                quotaFull:
                    'Kuota grup telah mencapai batas paket Anda. Silakan upgrade untuk menambah lebih banyak grup.',
                quotaReachedNotice:
                    'Batas whitelist telah mencapai batas maksimum sesuai paket Anda. Untuk menambahkan grup baru, hapus salah satu grup dari daftar.',
                accountGroupsTitle: 'Pilih Grup WhatsApp',
                accountGroupsSubtitle:
                    'Daftar grup tempat bot bergabung bersama Anda, atau dari sub-bot Anda yang terhubung.',
                botInviteNotice:
                    'Bot harus diundang ke grup WhatsApp terlebih dahulu agar dapat terdeteksi, kecuali jika akun Anda terhubung sebagai sub-bot.',
                searchPlaceholder: 'Cari grup berdasarkan nama atau JID...',
                noAccountGroupsFound: 'Tidak ada grup bersama yang terdeteksi.',
                noAccountGroupsHint:
                    'Pastikan bot telah dimasukkan ke dalam grup WhatsApp Anda, atau hubungkan akun Anda sebagai sub-bot. Anda juga dapat memasukkan JID grup secara manual di bawah.',
                membersCount: '{count} anggota',
                addToWhitelist: 'Tambah ke Whitelist',
                alreadyWhitelisted: 'Ter-whitelist',
                adminBadge: 'Admin',
                memberBadge: 'Anggota',
                manualJidToggle: 'Atau masukkan JID grup secara manual',
                enterManualJid: 'Masukkan JID grup manual',
                refreshGroups: 'Segarkan daftar',
                loadingAccountGroups: 'Memuat grup dari akun WhatsApp Anda...',
                quotaUsageText: 'Kuota: {current} dari {max} grup ({tier})'
            },
            profileCard: {
                title: 'Ringkasan Profil Akun',
                userId: 'JID Akun',
                username: 'Username',
                email: 'Email',
                balance: 'Saldo Virtual',
                creditScore: 'Skor Kredit'
            }
        },
        pairingModal: {
            title: 'Tautkan Sub-Bot WhatsApp',
            subtitle: 'Pilih metode tautan untuk menghubungkan nomor Anda sebagai sub-bot baru.',
            methodCode: '8-Digit Pairing Code',
            methodQr: 'Scan QR Code',
            phoneLabel: 'Nomor WhatsApp yang akan ditautkan',
            phonePlaceholder: '628987654321',
            phoneHelp: 'Pastikan nomor aktif di aplikasi WhatsApp pada ponsel Anda.',
            requestBtn: 'Dapatkan Kode Pairing',
            requestQrBtn: 'Tampilkan QR Code',
            countdown: 'Berlaku selama:',
            instructionCodeTitle: 'Cara Memasukkan Kode:',
            instructionStep1: '1. Buka aplikasi WhatsApp di ponsel Anda.',
            instructionStep2: '2. Buka menu Pengaturan > Perangkat Tertaut > Tautkan Perangkat.',
            instructionStep3: '3. Pilih "Tautkan dengan nomor telepon saja" dan masukkan kode 8-digit di bawah.',
            codeDisplayLabel: 'Kode Pairing Anda:',
            copyCode: 'Salin Kode',
            qrHelp: 'Arahkan pemindai WhatsApp ke QR Code di bawah:',
            successTitle: 'Sub-Bot Berhasil Ditautkan!',
            successDesc: 'Instance sub-bot Anda sekarang telah aktif dan siap menerima perintah.',
            close: 'Tutup',
            loading: 'Menghubungkan ke engine Baileys...',
            errorQuota: 'Kuota sub-bot Anda telah habis. Silakan upgrade paket langganan Anda.',
            errorNoCredential: 'Engine bot tidak mengembalikan kredensial pairing. Silakan coba lagi.',
            qrRendering: 'Merender QR Code...',
            waitingAuth: 'Menunggu otorisasi koneksi dari WhatsApp...'
        },
        sales: {
            prefillMsg:
                'Halo Tim Sales Cosmos! Saya ingin berlangganan paket berbayar Cosmos.\n\nPaket: {tier}\nHarga: {price} / bulan\nNomor Akun: {phone}\nRef Order: {ref}\n\nMohon kirimkan detail QRIS / rekening pembayaran.'
        },
        common: {
            error: 'Terjadi kesalahan',
            success: 'Berhasil',
            close: 'Tutup',
            copied: 'Berhasil disalin!',
            networkError: 'Koneksi ke server terputus. Pastikan server API aktif.',
            retry: 'Coba Lagi'
        },
        footer: {
            description:
                'Bot WhatsApp untuk kebutuhan bisnis, personal, dan komunitas; keamanan dan platform dilindungi oleh Cloudflare. Proyek ini dibuat oleh RazaelFox dan tidak berafiliasi dengan WhatsApp atau Meta.',
            navHeading: 'Navigasi',
            securityHeading: 'Keamanan & Akun',
            trustHeading: 'Kepercayaan & Status',
            noteAntiSpam: 'Inverted Verification Anti-Spam',
            noteVps: 'LXC NAT VPS Support',
            rights: 'Hak cipta dilindungi undang-undang.',
            statusText: 'Semua Sistem Beroperasi Normal',
            salesBtn: 'WhatsApp Sales'
        }
    },

    en: {
        nav: {
            brand: 'Cosmos',
            tagline: 'WhatsApp & Multi-Device Bot Platform',
            portalBadge: 'Multi-Device Portal',
            home: 'Home',
            howItWorks: 'How It Works',
            pricing: 'Pricing',
            status: 'System Status',
            dashboard: 'Dashboard',
            register: 'Register',
            login: 'Login',
            logout: 'Logout',
            language: 'Language'
        },
        announcement: {
            message: 'Anti-banned inverted verification — zero OTP spam-ban risk',
            cta: 'Try Now →'
        },
        hero: {
            eyebrow: 'Anti-Banned Inverted Verification • Baileys Multi-Device',
            title: 'Autonomous WhatsApp Bots for Modern Teams & Communities',
            subtitle:
                'Connect your personal WhatsApp numbers as autonomous sub-bots, automate group chats, and enjoy integrated virtual banking with high-speed, ban-free verified infrastructure.',
            ctaRegister: 'Get Started Free',
            ctaPricing: 'View Pricing Plans',
            ctaHowItWorks: 'See How It Works',
            ctaTitle: 'Ready to Launch Your WhatsApp Bot?',
            ctaDesc:
                'Register your WhatsApp number now via secure ban-free verification, and start linking sub-bots within minutes.',
            trustFree: '2 Sub-Bots Free',
            trustNoCard: 'No Credit Card Required',
            trustPayment: 'Instant WhatsApp QRIS/Bank Activation',
            feature1Title: 'Multi-Device Sub-Bots',
            feature1Desc: 'Link your personal WhatsApp number as an autonomous sub-bot using pairing code or QR scan.',
            feature2Title: 'Anti-Banned Verification',
            feature2Desc: 'Inverted verification via inbound WhatsApp messages from the user with zero spam-ban risk.',
            feature3Title: 'Tiered Quota & Groups',
            feature3Desc: 'Whitelist WhatsApp groups and manage group quotas centrally with fair, tiered subscriptions.'
        },
        howItWorks: {
            title: 'How Cosmos Works',
            subtitle: 'Connect autonomous sub-bots and manage communities in 3 simple steps.',
            step1Title: '1. Register WhatsApp Number',
            step1Desc: 'Register your number using our secure signup flow protected by Cloudflare Turnstile.',
            step2Title: '2. Verify with Zero Ban Risk',
            step2Desc:
                'Send .verify <TOKEN> directly from your WhatsApp to our bot. WhatsApp recognizes it as genuine user-initiated chat.',
            step3Title: '3. Pair Sub-Bots & Whitelist Groups',
            step3Desc:
                'Use the 8-digit Pairing Code or scan QR to activate your sub-bot and whitelist community groups.'
        },
        howItWorksPage: {
            badge: 'Onboarding Walkthrough',
            whyTitle: 'Why Inverted Verification?',
            whyDesc:
                'Our verification reverses the traditional flow: you initiate the first message to the official bot. WhatsApp anti-spam algorithms recognize this inbound interaction as organic user communication, entirely eliminating the risk of spam flagging or account bans.',
            pairingTitle: 'How Sub-Bot Pairing Works',
            pairingDesc:
                'Using the official WhatsApp Linked Devices protocol (Baileys Multi-Device), your phone operates as an independent node without ever revealing account credentials or private passwords.',
            readyTitle: 'Ready to Launch Your WhatsApp Bot?',
            readyDesc: 'Register now and enjoy 2 free autonomous sub-bot slots forever.',
            ctaBtn: 'Get Started Free',
            dashboardBtn: 'Go to Dashboard'
        },
        statusPage: {
            title: 'System Status & Telemetry',
            subtitle: 'Real-time operational health, sub-bot connectivity, and infrastructure telemetry.',
            allOperational: 'All Systems Operational',
            partialOutage: 'Partial Service Degradation',
            majorOutage: 'Major Service Outage',
            operational: 'Operational',
            degraded: 'Degraded',
            outage: 'Outage',
            subbotsTitle: 'Connected Sub-Bots',
            subbotsDesc: 'Active sub-bot instances operating on the network',
            uptimeTitle: 'System Uptime',
            uptimeDesc: 'Continuous operational availability rate',
            groupsTitle: 'Whitelisted Groups',
            groupsDesc: 'Active community WhatsApp groups protected',
            banTitle: 'Spam-Ban Incidence',
            banDesc: 'Confirmed carrier or platform suspensions',
            servicesTitle: 'Component Service Health',
            servicesDesc: 'Live connectivity status and latency of core micro-services',
            lastChecked: 'Last checked:',
            refreshBtn: 'Refresh Status',
            refreshing: 'Syncing...',
            viewStatus: 'View Status',
            backHome: 'Back to Home',
            back: 'Back',
            slideBackHint: 'Swipe right to go back',
            latency: 'Latency'
        },
        features: {
            title: 'Cosmos Core Features',
            subtitle: 'Engineered for team productivity, operational reliability, and total number protection.',
            subbots: {
                title: 'Multi-Device Sub-Bot Pairing',
                desc: 'Link your WhatsApp number instantly using an 8-digit Pairing Code or QR streaming without hosting or managing your own server.',
                badge: 'Zero-Host Autonomous Connection'
            },
            security: {
                title: 'Layered Security & Login Alerts',
                desc: 'Cloudflare Turnstile protection, secure session management, and real-time WhatsApp security alerts for unrecognized activities.',
                badge: 'Cloudflare Ingress & Session Encryption'
            },
            whitelist: {
                title: 'Group Whitelist & Access Control',
                desc: 'Complete control over allowed WhatsApp groups with strict tenant ownership validation, preventing unauthorized spam in shared spaces.',
                badge: 'Tenant Isolation & Quota Guards'
            },
            economy: {
                title: 'Virtual Economy & Chat Automation',
                desc: 'Engage communities with automated virtual banking, transparent transaction ledgers, credit rating levels, and interactive minigames.',
                badge: 'Community Banking & Games'
            }
        },
        pricing: {
            title: 'Subscription Plans & Pricing',
            subtitle: 'Select the tier tailored to your WhatsApp bot and community operational needs.',
            orderNow: 'Subscribe Now',
            contactSales: 'Contact Sales',
            periodMonth: '/ month',
            included: 'Included features:',
            popular: 'Most Popular',
            activePlan: 'Your Current Plan',
            salesNoticeTitle: 'Direct WhatsApp Sales Flow:',
            salesNoticeStep1: '1. Click your desired subscription tier',
            salesNoticeStep2: '2. WhatsApp opens with your unique order reference',
            salesNoticeStep3: '3. Complete payment via QRIS or Bank Transfer',
            salesNoticeStep4: '4. Quotas activate instantly in your dashboard',
            manualFlowNotice: 'Direct manual payment via WhatsApp to Sales Rep using QRIS / Bank Transfer.',
            free: {
                name: 'Free',
                price: 'Rp0',
                desc: 'Ideal for personal users testing out WhatsApp bot automation capabilities.',
                features: [
                    '2 Active Sub-Bots',
                    '5 Whitelisted Groups',
                    'Standard Prefix (.)',
                    'Community Support',
                    'Standard Bot Features',
                    '1.0x Virtual Economy Multiplier'
                ],
                cta: 'Start for Free'
            },
            subsidized: {
                name: 'Subsidized',
                price: 'Rp10.000',
                desc: 'Best affordable option for growing communities and active group administrators.',
                features: [
                    '5 Active Sub-Bots',
                    '10 Whitelisted Groups',
                    'Custom Prefix per sub-bot',
                    'Medium Priority Support',
                    'Advanced Bot Features',
                    '1.05x Virtual Economy Multiplier'
                ],
                cta: 'Choose Subsidized'
            },
            partner: {
                name: 'Partner',
                price: 'Rp32.000',
                desc: 'Complete high-capacity tier for large communities, networks, and power users.',
                features: [
                    '12 Active Sub-Bots',
                    '25 Whitelisted Groups',
                    'Custom Prefix per sub-bot',
                    'High Priority Support (Direct Partner)',
                    'Early Access to new features',
                    '1.15x Virtual Economy Multiplier'
                ],
                cta: 'Choose Partner'
            }
        },
        auth: {
            registerTitle: 'Create Cosmos Account',
            registerSubtitle: 'Register your WhatsApp number to unlock web portal and sub-bot management access.',
            loginTitle: 'Sign In to Your Account',
            loginSubtitle: 'Enter your WhatsApp phone number or username and password.',
            step1Label: '1. Account Info',
            step2Label: '2. WhatsApp Verify',
            step3Label: '3. Ready to Use',
            phoneLabel: 'WhatsApp Phone Number',
            phonePlaceholder: '628123456789',
            phoneHelp: 'Use international country code without plus sign or leading zero (e.g. 628...)',
            phonePreviewPrefix: 'Account JID Preview:',
            usernameLabel: 'Username (Optional)',
            usernamePlaceholder: 'your_username',
            emailLabel: 'Email (Optional)',
            emailPlaceholder: 'name@example.com',
            passwordLabel: 'Password',
            passwordPlaceholder: '••••••••',
            confirmPasswordLabel: 'Confirm Password',
            identifierLabel: 'WhatsApp Phone or Username',
            identifierPlaceholder: '628123456789 or username',
            invertedTab: 'WhatsApp Verify (Recommended)',
            directTab: 'Direct OTP (Fallback)',
            turnstileRequired: 'Please complete the Cloudflare Turnstile challenge first.',
            submitRegister: 'Register & Verify via WhatsApp',
            submitRegisterDirect: 'Send OTP Code to WhatsApp',
            submitLogin: 'Sign In to Dashboard',
            alreadyHaveAccount: 'Already have an account? Sign in here',
            noAccount: "Don't have an account? Register now",
            loading: 'Processing...',
            orDivider: 'or',
            invalidPhone: 'Please enter a valid WhatsApp number (at least 10 digits).',
            passwordMinLength: 'Password must be at least 6 characters.',
            passwordMismatch: 'Password confirmation does not match.',
            loginFailed: 'Login failed. Please check your account and password.',
            invertedInfo:
                'You send the verification message to the bot first, so WhatsApp validates the interaction as an organic message.',
            directInfo:
                'The bot will send a 6-digit OTP code to your WhatsApp number. Limited to 5 requests per 15 minutes.',
            forgotPasswordHint: 'Forgot password? Contact Sales/Admin to reset your credentials.'
        },
        invertedVerify: {
            title: 'Verify WhatsApp Ownership',
            subtitle: 'Send the pre-filled verification message from your WhatsApp to activate your account instantly.',
            step1: '1. Click the green button below to open WhatsApp to Cosmos Bot.',
            step2: '2. Send the pre-filled message without modifying the code:',
            step3: '3. The system will automatically detect verification and redirect you to the Dashboard.',
            whatsappBtn: 'Open WhatsApp & Send Verification',
            tokenLabel: 'Opaque Verification Token:',
            copyBtn: 'Copy Token',
            copied: 'Copied!',
            waitingWs: 'Waiting for verification event from WhatsApp...',
            expiresIn: 'Token expires in:',
            cancel: 'Cancel',
            success: 'Verification Successful! Redirecting...',
            timeout: 'Verification token expired. Please try again.'
        },
        directOtp: {
            title: 'Enter WhatsApp OTP Code',
            subtitle: 'A 6-digit verification code has been dispatched to your WhatsApp number.',
            otpLabel: 'OTP Code (6 Digits)',
            otpPlaceholder: '123456',
            verifyBtn: 'Verify & Sign In',
            resendBtn: 'Resend OTP',
            resendCountdown: 'Resend available in',
            expired: 'Code expired. Please request a new one.',
            invalid: 'Invalid OTP code. Please check your WhatsApp messages.',
            expiresInLabel: 'Expires:',
            resending: 'Sending...',
            resent: 'A new OTP has been sent to your WhatsApp.'
        },
        dashboard: {
            welcome: 'Welcome back,',
            overviewLabel: 'Portal Member',
            headerSubtitle:
                'Manage multi-device sub-bots, monitor plan quotas, and control your WhatsApp group permissions.',
            validUntilPrefix: 'Valid until:',
            usedSuffix: 'Used',
            botsSlotsLeft: '{count} more sub-bot slots available on your plan.',
            groupsSlotsLeft: '{count} more group whitelist slots available.',
            addGroupDesc: 'Enter the WhatsApp Group JID authorized to respond to the bot.',
            whitelistActive: 'Verified Account',
            whitelistPending: 'Pending WhatsApp Verification',
            invalidGroupJid: 'Group JID must end with @g.us (e.g. 120363023456789@g.us)',
            confirmDeleteBotTitle: 'Disconnect Sub-Bot',
            confirmDeleteBotDesc:
                'Are you sure you want to disconnect this sub-bot? Its WhatsApp connection session will be terminated.',
            confirmDeleteGroupTitle: 'Remove Whitelisted Group',
            confirmDeleteGroupDesc: 'Are you sure you want to remove authorization for this group?',
            confirmBtn: 'Yes, Proceed',
            cancelBtn: 'Cancel',
            planCard: {
                title: 'Subscription Status',
                currentTier: 'Current Plan',
                status: 'Status',
                expiresAt: 'Valid Until',
                perpetual: 'Perpetual (Free)',
                upgradeBtn: 'Upgrade Plan',
                subBotsQuota: 'Sub-Bot Quota',
                groupsQuota: 'Group Whitelist Quota',
                prefixFeature: 'Custom Prefix',
                allowed: 'Enabled',
                locked: 'Locked (Default .)'
            },
            subbotsCard: {
                title: 'Connected Multi-Device Sub-Bots',
                subtitle: 'Manage WhatsApp sub-bot instances operating under your phone number.',
                pairBtn: 'Pair New Sub-Bot',
                noBots: 'No sub-bots connected yet.',
                noBotsDesc:
                    'Connect your personal WhatsApp number as an autonomous sub-bot using a pairing code or QR.',
                phoneCol: 'Bot Number',
                prefixCol: 'Prefix',
                statusCol: 'Status',
                createdCol: 'Created',
                actionsCol: 'Actions',
                statusActive: 'Active',
                statusPaused: 'Paused',
                statusDisconnected: 'Disconnected',
                startBtn: 'Start',
                stopBtn: 'Stop',
                deleteBtn: 'Disconnect',
                confirmDelete: 'Are you sure you want to disconnect this sub-bot?'
            },
            groupsCard: {
                title: 'Whitelisted WhatsApp Groups',
                subtitle: 'List of groups authorized to respond to your Cosmos bot commands.',
                addBtn: 'Whitelist Group',
                noGroups: 'No whitelisted groups yet.',
                noGroupsDesc: 'Add a group JID so the bot can respond to members in shared group chats.',
                jidCol: 'Group ID (JID)',
                addedCol: 'Added On',
                actionCol: 'Actions',
                deleteBtn: 'Remove Whitelist',
                confirmDeleteGroup: 'Are you sure you want to remove whitelist for this group?',
                addModalTitle: 'Whitelist New WhatsApp Group',
                jidInputLabel: 'WhatsApp Group JID',
                jidPlaceholder: '120363023456789@g.us',
                jidHelp: 'Find your group JID by typing .getjid inside the target WhatsApp group.',
                submitAdd: 'Save to Whitelist',
                cancelAdd: 'Cancel',
                quotaFull: 'Group quota limit reached for your plan. Please upgrade to add more groups.',
                quotaReachedNotice:
                    'The whitelist has reached its limit based on your plan. To add more groups, remove one from the list.',
                accountGroupsTitle: 'Select WhatsApp Groups',
                accountGroupsSubtitle:
                    'Groups where the bot is a member with you, or from your linked sub-bot account.',
                botInviteNotice:
                    'The bot must be invited to your WhatsApp group first to be detected, unless your account is linked as a sub-bot.',
                searchPlaceholder: 'Search groups by name or JID...',
                noAccountGroupsFound: 'No shared groups detected.',
                noAccountGroupsHint:
                    'Make sure the bot has been added to your WhatsApp group, or link your account as a sub-bot. You can also enter the group JID manually below.',
                membersCount: '{count} members',
                addToWhitelist: 'Add to Whitelist',
                alreadyWhitelisted: 'Whitelisted',
                adminBadge: 'Admin',
                memberBadge: 'Member',
                manualJidToggle: 'Or enter group JID manually',
                enterManualJid: 'Enter Group JID manually',
                refreshGroups: 'Refresh groups list',
                loadingAccountGroups: 'Loading groups from your WhatsApp account...',
                quotaUsageText: 'Quota usage: {current} / {max} groups ({tier})'
            },
            profileCard: {
                title: 'Account Profile Summary',
                userId: 'Account JID',
                username: 'Username',
                email: 'Email',
                balance: 'Virtual Balance',
                creditScore: 'Credit Score'
            }
        },
        pairingModal: {
            title: 'Pair WhatsApp Sub-Bot',
            subtitle: 'Choose a linking method to connect your number as a new autonomous sub-bot.',
            methodCode: '8-Digit Pairing Code',
            methodQr: 'Scan QR Code',
            phoneLabel: 'WhatsApp Phone Number to Link',
            phonePlaceholder: '628987654321',
            phoneHelp: 'Make sure this number is active on your phone WhatsApp client.',
            requestBtn: 'Get Pairing Code',
            requestQrBtn: 'Display QR Code',
            countdown: 'Expires in:',
            instructionCodeTitle: 'How to Enter Pairing Code:',
            instructionStep1: '1. Open WhatsApp on your primary phone.',
            instructionStep2: '2. Go to Settings > Linked Devices > Link a Device.',
            instructionStep3: '3. Tap "Link with phone number instead" and enter the 8-digit code below.',
            codeDisplayLabel: 'Your Pairing Code:',
            copyCode: 'Copy Code',
            qrHelp: 'Point your WhatsApp camera scanner at the QR code below:',
            successTitle: 'Sub-Bot Successfully Paired!',
            successDesc: 'Your sub-bot instance is now live and ready to process commands.',
            close: 'Close',
            loading: 'Connecting to Baileys engine...',
            errorQuota: 'Sub-bot quota exceeded for your subscription plan. Please upgrade first.',
            errorNoCredential: 'Bot engine did not return pairing credentials. Please try again.',
            qrRendering: 'Rendering QR code...',
            waitingAuth: 'Waiting for connection authorization from WhatsApp...'
        },
        sales: {
            prefillMsg:
                'Hello Cosmos Sales! I would like to subscribe to a paid tier.\n\nPlan: {tier}\nPrice: {price} / month\nTarget Number: {phone}\nOrder Ref: {ref}\n\nPlease send the payment QRIS / account details.'
        },
        common: {
            error: 'An error occurred',
            success: 'Success',
            close: 'Close',
            copied: 'Copied to clipboard!',
            networkError: 'Unable to reach API server. Please ensure the backend is active.',
            retry: 'Try Again'
        },
        footer: {
            description:
                'WhatsApp bots for business, personal, and community needs; security and the platform are protected by Cloudflare. The project was created by RazaelFox and is not affiliated with WhatsApp or Meta.',
            navHeading: 'Navigation',
            securityHeading: 'Security & Account',
            trustHeading: 'Trust & Status',
            noteAntiSpam: 'Inverted Verification Anti-Spam',
            noteVps: 'LXC NAT VPS Support',
            rights: 'All rights reserved.',
            statusText: 'All Systems Operational',
            salesBtn: 'WhatsApp Sales'
        }
    }
};

type DeepString<T> = {
    readonly [K in keyof T]: T[K] extends readonly string[]
        ? readonly string[]
        : T[K] extends object
          ? DeepString<T[K]>
          : string;
};

export type Dictionary = DeepString<typeof rawDictionary.id>;
export const dictionary: Record<Language, Dictionary> = rawDictionary;
