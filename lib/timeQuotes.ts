export interface TimeQuoteBucket {
    startHour: number; // inclusive (e.g. 6)
    endHour: number; // exclusive (e.g. 9)
    en: string[];
    id: string[];
}

export const TIME_QUOTE_BUCKETS: TimeQuoteBucket[] = [
    {
        // 00:00 - 05:59: Dawn / Late Night (The Owl Hours)
        startHour: 0,
        endHour: 6,
        en: [
            'So, are you an owl?',
            'Go to sleep. Even the WhatsApp servers are questioning your life choices right now.',
            'Nothing good was ever coded after 2 AM, especially bot scripts.',
            'Photosynthesis starts in a few hours. You should probably close your eyes.',
            'Blink twice if the insomnia is winning.',
            'Why are you awake? Even the nighttime bugs went to bed hours ago.',
            'The dashboard will still be here tomorrow. Your sanity might not.'
        ],
        id: [
            'Jadi, kamu burung hantu?',
            'Tidur sana. Bahkan server WhatsApp pun heran sama pola tidurmu jam segini.',
            'Nggak ada kodingan bagus yang lahir lewat jam 2 pagi, apalagi skrip bot.',
            'Fotosintesis tinggal beberapa jam lagi. Mendingan merem sekarang.',
            'Kedipkan mata dua kali kalau insomnianya mulai menang.',
            'Ngapain masih bangun? Bug malam aja udah pada tidur pules.',
            'Dashboard-nya bakal tetap ada besok pagi. Kewarasanmu yang belum tentu.'
        ]
    },
    {
        // 06:00 - 08:59: Early Morning (Roasting the Early Risers)
        startHour: 6,
        endHour: 9,
        en: [
            'Awake before 9 AM? Who hurt you?',
            'Look at you, being an early bird. The worm isn’t even awake yet.',
            'Productivity this early is suspicious. Are you being held hostage by a morning standup?',
            'Drinking coffee just to pretend you enjoy morning capitalism, are we?',
            'Rise and grind? More like rise and question every life decision that led to this morning.',
            'The alarm went off and you actually got out of bed? Stop showing off.',
            'Working before 9 AM is statistically proven to increase audible sighing by 400%.'
        ],
        id: [
            'Bangun sebelum jam 9? Siapa yang nyakitin kamu pagi-pagi begini?',
            'Rajin amat bangun pagi. Cacingnya aja masih tidur.',
            'Produktivitas sepagi ini mencurigakan. Kamu lagi disandera rapat pagi ya?',
            'Minum kopi cuma buat pura-pura siap menghadapi realita, kan?',
            'Bangun pagi demi masa depan? Lebih mirip bangun pagi sambil mempertanyakan pilihan hidup.',
            'Alarm bunyi langsung bangun? Pamer banget punya motivasi hidup.',
            'Kerja sebelum jam 9 pagi terbukti secara ilmiah meningkatkan frekuensi menghela napas.'
        ]
    },
    {
        // 09:00 - 11:59: Morning Focus (Peak Pretending)
        startHour: 9,
        endHour: 12,
        en: [
            'Peak hours of pretending to look busy while intensely staring at dashboard metrics.',
            'Your bot has responded to 50 messages today. You, on the other hand, have accomplished zero.',
            'Drink some water. Dehydration won’t make your bugs fix themselves.',
            'Staring intensely at the screen does not make the code run faster, but nice effort.',
            'Current status: Looking extremely focused so nobody assigns you more tasks.',
            'Tabs open: 47. RAM usage: 98%. Productivity: Questionable.'
        ],
        id: [
            'Jam-jam puncak pura-pura sibuk sambil mantau angka di dashboard.',
            'Bot kamu udah balas puluhan pesan hari ini. Kamunya sendiri belum ngapa-ngapain.',
            'Minum air dulu. Dehidrasi nggak bakal bikin bug-nya sembuh sendiri.',
            'Natap layar tajem-tajem nggak bikin kodingan jalan lebih cepet, tapi lumayanlah usahanya.',
            'Status saat ini: Pasang muka serius biar nggak dikasih kerjaan tambahan sama bos.',
            'Tab kebuka: 47. RAM terpakai: 98%. Produktivitas: Sangat dipertanyakan.'
        ]
    },
    {
        // 12:00 - 16:59: Afternoon (Break Time & Food Coma)
        startHour: 12,
        endHour: 17,
        en: [
            'It’s past noon. Drop the keyboard and go touch some food.',
            'Time for a break. Your brain has officially entered low-power mode.',
            'Post-lunch food coma detected. 90% of your cognitive capacity is currently digesting carbs.',
            'Step away from the screen before you accidentally deploy untested code to production.',
            'Warning: High risk of accidental production pushes during the afternoon slump. Take a nap.',
            'If you stare at this dashboard any longer, your coffee will get cold and your spirit colder.',
            'Go stretch. You’ve been sitting in that exact shape for four hours straight.'
        ],
        id: [
            'Udah lewat tengah hari. Lepas keyboard-nya, waktunya istirahat dan makan.',
            'Waktunya rehat. Otak kamu udah resmi masuk mode hemat daya.',
            'Koma sehabis makan siang terdeteksi. 90% kapasitas otak lagi sibuk mencerna karbo.',
            'Mundur pelan-pelan dari layar sebelum kamu nggak sengaja deploy ke production.',
            'Peringatan: Risiko tinggi salah pencet pas ngantuk siang. Mending tidur siang sebentar.',
            'Kalo diliatin terus dashboard-nya, kopimu bakal dingin dan jiwamu makin hampa.',
            'Peregangan dulu sana. Udah empat jam duduk dengan posisi udang bungkuk begitu.'
        ]
    },
    {
        // 17:00 - 20:59: Evening / Sunset (Log Off)
        startHour: 17,
        endHour: 21,
        en: [
            'Work hours are over. The bot will survive without you micromanaging it.',
            'Congratulations on surviving another day of digital chaos. You may now unplug.',
            'Time to log off and complain about your day on social media.',
            'Your computer fan has been screaming for 8 hours straight. Give the poor machine some peace.',
            'Closing browser tabs is the ultimate form of self-care right now. Try it.',
            'The sun is setting. Go verify that the outside world still exists.'
        ],
        id: [
            'Jam kerja udah kelar. Bot-nya bakal baik-baik aja tanpa kamu pantau terus.',
            'Selamat telah selamat dari kekacauan hari ini. Waktunya tutup laptop.',
            'Waktunya log off dan lanjut ngeluhin kerjaan di media sosial.',
            'Kipas komputermu udah teriak-teriak selama 8 jam nonstop. Kasih napas dikit tuh mesin.',
            'Nutup tab browser itu terapi paling ampuh jam segini. Cobain deh.',
            'Matahari udah terbenam. Coba intip jendela, mastiin dunia luar masih ada.'
        ]
    },
    {
        // 21:00 - 23:59: Night (Bedtime Procrastination)
        startHour: 21,
        endHour: 24,
        en: [
            'Bedtime was an hour ago, but here you are, fine-tuning WhatsApp groups.',
            'Checking server stats in bed is not a valid substitute for sleep.',
            'The blue light from your screen is not nutrition. Go rest.',
            'Revenge bedtime procrastination at its finest. Just one more reload?',
            'Nothing good was ever discovered by refreshing a dashboard at 11 PM.',
            'Your future self tomorrow morning is already disappointed in you.'
        ],
        id: [
            'Harusnya udah tidur sejam lalu, malah asyik mantau grup WhatsApp.',
            'Cek status server di kasur bukan pengganti tidur yang sehat, ya.',
            'Cahaya biru dari layar itu bukan nutrisi. Istirahat sana.',
            'Revenge bedtime procrastination tingkat dewa. Yakin mau reload sekali lagi?',
            'Nggak pernah ada keajaiban yang muncul dari refresh dashboard jam 11 malam.',
            'Dirimu besok pagi pas bangun udah siap-siap kecewa sama keputusan malam ini.'
        ]
    }
];

export function getRandomTimeQuote(hour?: number, lang: 'en' | 'id' = 'en'): string {
    const currentHour = typeof hour === 'number' ? hour : new Date().getHours();
    const bucket =
        TIME_QUOTE_BUCKETS.find((b) => currentHour >= b.startHour && currentHour < b.endHour) || TIME_QUOTE_BUCKETS[0];

    const quotes = bucket[lang] || bucket.en;
    const randomIndex = Math.floor(Math.random() * quotes.length);
    return quotes[randomIndex];
}
