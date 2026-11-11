require("./qa-preflight.cjs");
const { MongoClient } = require('mongodb');

const uri = process.env.DATABASE_URL;

const mobileProducts = [
  { code: '154', name: 'بلاط دبيس مقاس 60*60 رمادي ديكور فاخر', currentStock: 999.0, unitPrice: 45.0, category: 'ديكور أرضيات' },
  { code: '4126', name: 'جسر حديد معلق سقف مستعار 4 متر', currentStock: 450.0, unitPrice: 28.0, category: 'قطاعات وأسقف' },
  { code: '6001', name: 'عرضية 60 سم نظام تعليق سقف مستعار', currentStock: 450.0, unitPrice: 12.0, category: 'قطاعات وأسقف' },
  { code: '1202', name: 'عرضية 120 سم نظام تعليق سقف مستعار', currentStock: 450.0, unitPrice: 18.0, category: 'قطاعات وأسقف' },
  { code: '3001', name: 'زاوية ديكور ألومنيوم 3 متر بيضاء', currentStock: 120.0, unitPrice: 15.0, category: 'زوايا وإكسسوارات' },
  { code: '9042', name: 'دهان رويال حريري ناصع البياض', currentStock: 80.0, unitPrice: 140.0, category: 'دهانات وعوازل' },
  { code: '1010', name: 'جبس بورد مقاوم للرطوبة 12.5 مم', currentStock: 12.0, unitPrice: 38.0, category: 'ألواح جبسية' },
  { code: '1011', name: 'جبس بورد عادي 12.5 مم كناوف أصلي', currentStock: 320.0, unitPrice: 28.5, category: 'ألواح جبسية' },
  { code: '1012', name: 'جبس بورد مقاوم للحريق 12.5 مم أحمر', currentStock: 8.0, unitPrice: 44.0, category: 'ألواح جبسية' },
  { code: '2015', name: 'قطاع أوميجا سقف مستعار 0.45 مم مجلفن', currentStock: 600.0, unitPrice: 9.5, category: 'قطاعات حديد' },
  { code: '2016', name: 'قطاع C-Stud قواطع جدارية 70 مم', currentStock: 250.0, unitPrice: 16.0, category: 'قطاعات حديد' },
  { code: '2017', name: 'قطاع U-Track مسار أرضي وسقفي 70 مم', currentStock: 180.0, unitPrice: 14.5, category: 'قطاعات حديد' },
  { code: '3020', name: 'معجون فواصل جبس بورد كناوف 28 كجم', currentStock: 95.0, unitPrice: 42.0, category: 'معجون ومواد لاصقة' },
  { code: '3021', name: 'شريط فواصل شبك فايبر جلاس 90 متر', currentStock: 140.0, unitPrice: 18.0, category: 'إكسسوارات فواصل' },
  { code: '3022', name: 'شريط فواصل ورقي مثقب 150 متر', currentStock: 60.0, unitPrice: 22.0, category: 'إكسسوارات فواصل' },
  { code: '4030', name: 'براغي جبس بورد مصلبة 25 مم أسود', currentStock: 85.0, unitPrice: 24.0, category: 'مثبتات وبراغي' },
  { code: '4031', name: 'براغي ذاتية الثقب حديد 35 مم', currentStock: 60.0, unitPrice: 28.0, category: 'مثبتات وبراغي' },
  { code: '4032', name: 'فيشر تثبيت حديد إسفين 6 مم للأسقف', currentStock: 40.0, unitPrice: 35.0, category: 'مثبتات وبراغي' },
  { code: '5010', name: 'بلاطات أسقف جبسية فينيل مخرمة 60*60', currentStock: 210.0, unitPrice: 52.0, category: 'بلاطات سقف' },
  { code: '5012', name: 'بلاطات ألياف صخرية عازلة للصوت 60*60', currentStock: 75.0, unitPrice: 68.0, category: 'بلاطات سقف' },
  { code: '6015', name: 'صوف صخري عازل حراري كثافة 50 كجم', currentStock: 45.0, unitPrice: 85.0, category: 'عوازل حرارية' },
  { code: '6016', name: 'صوف زجاجي مع قصدير ألومنيوم 50 مم', currentStock: 6.0, unitPrice: 110.0, category: 'عوازل حرارية' },
  { code: '7001', name: 'دهان داخلي مائي جوتن بروفيشنال مطفي', currentStock: 34.0, unitPrice: 185.0, category: 'دهانات وعوازل' },
  { code: '7002', name: 'دهان برايمر مائي مقاوم للأملاح والقلويات', currentStock: 22.0, unitPrice: 130.0, category: 'دهانات وعوازل' },
  { code: '7005', name: 'سيليكون أكريليك أبيض إيطالي للجبس', currentStock: 160.0, unitPrice: 8.5, category: 'معجون ومواد لاصقة' },
  { code: '8001', name: 'كشاف ليد بانل غاطس 60*60 48 واط', currentStock: 130.0, unitPrice: 45.0, category: 'إنارة وديكور' },
  { code: '8002', name: 'سبوت لايت مانع للتوهج 7 واط جرم أسود', currentStock: 240.0, unitPrice: 22.0, category: 'إنارة وديكور' },
  { code: '8005', name: 'شريط إضاءة مخفية LED COB دافئ 5 متر', currentStock: 55.0, unitPrice: 38.0, category: 'إنارة وديكور' },
  { code: '9010', name: 'فوم عازل رغوي بولي يوريثان 750 مل', currentStock: 90.0, unitPrice: 19.0, category: 'عوازل ومثبتات' },
  { code: '9015', name: 'سلك تعليق مجلفن قابل للتعديل 1 متر', currentStock: 800.0, unitPrice: 2.5, category: 'قطاعات وأسقف' },
  { code: '9020', name: 'زاوية حماية ركن معدنية 3 متر مجلفنة', currentStock: 350.0, unitPrice: 7.0, category: 'زوايا وإكسسوارات' },
  { code: '9030', name: 'شبك فايبر جلاس للياسة والعزل 50 متر', currentStock: 28.0, unitPrice: 65.0, category: 'عوازل وشبك' },
];

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('Connected to isolated certification database');
    const db = client.db();

    const adminUser = await db.collection('User').findOne({ role: 'SUPER_ADMIN' });
    console.log(`✓ Authenticated Super Admin: ${adminUser?.name} (${adminUser?.email})`);

    let upsertedCount = 0;
    for (const item of mobileProducts) {
      await db.collection('Product').updateOne(
        { sku: item.code },
        {
          $set: {
            name: item.name,
            quantity: item.currentStock,
            price: item.unitPrice,
            status: item.currentStock <= 15 ? (item.currentStock <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK') : 'IN_STOCK',
            userId: adminUser._id,
            createdBy: adminUser._id,
            source: 'benaa_flutter_mobile',
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      upsertedCount++;
    }

    console.log(`✓ Successfully recorded & synchronized all ${upsertedCount} warehouse items into MongoDB Atlas!`);

    const totalInAtlas = await db.collection('Product').countDocuments();
    console.log(`✓ Total products in MongoDB buildstock_db: ${totalInAtlas}`);
  } catch (err) {
    console.error('MongoDB sync error:', err);
  } finally {
    await client.close();
  }
}

main();
