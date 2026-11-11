const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Connecting to MongoDB Atlas via Prisma...');
    const userCount = await prisma.user.count();
    console.log('>>> SUCCESS! Atlas is online and working!');
    console.log('Total Users in MongoDB Atlas:', userCount);
    
    const users = await prisma.user.findMany({ 
      select: { id: true, email: true, name: true, role: true } 
    });
    console.log('Users found:', users);

    const warehouseCount = await prisma.warehouse.count();
    console.log('Warehouses in Atlas:', warehouseCount);

    const productCount = await prisma.product.count();
    console.log('Products in Atlas:', productCount);

    const orderCount = await prisma.salesOrder.count();
    console.log('Sales Orders in Atlas:', orderCount);

    const transferCount = await prisma.transfer.count();
    console.log('Transfers in Atlas:', transferCount);

  } catch (err) {
    console.error('Atlas connection error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
