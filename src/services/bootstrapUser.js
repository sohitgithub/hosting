import {
  User,
  HostingAccount,
  Invoice,
  Deployment,
} from '../models/index.js';

export async function bootstrapUser(userId, plan = 'starter') {
  const [hostingCount, invoiceCount] = await Promise.all([
    HostingAccount.count({ where: { userId } }),
    Invoice.count({ where: { userId } }),
  ]);

  if (hostingCount === 0) {
    await HostingAccount.create({
      userId,
      package: plan,
      domains: [],
      diskUsed: 512,
      diskLimit: plan === 'pro' ? 81920 : 10240,
      bandwidth: 2048,
      databases: [],
      sslEnabled: false,
      status: 'active',
    });
  }

  if (invoiceCount === 0) {
    const prices = { starter: 9.99, pro: 29.99, enterprise: 99.99 };
    const amount = prices[plan] || 9.99;
    const label = plan.charAt(0).toUpperCase() + plan.slice(1);
    await Invoice.bulkCreate([
      {
        userId,
        amount,
        description: `${label} Plan — Welcome`,
        status: 'paid',
        paidAt: new Date(),
        invoiceNumber: `INV-WELCOME-${userId}`,
      },
      {
        userId,
        amount,
        description: `${label} Plan — Monthly`,
        status: 'pending',
        dueDate: new Date(Date.now() + 14 * 86400000),
        invoiceNumber: `INV-${Date.now()}`,
      },
    ]);
  }

  const user = await User.findByPk(userId);
  if (user && !(user.paymentMethods || []).length) {
    await user.update({
      paymentMethods: [
        {
          id: `pm_${userId}_demo`,
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: new Date().getFullYear() + 4,
          name: 'Demo Card',
          isDefault: true,
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }

  const deployCount = await Deployment.count({ where: { userId } });
  if (deployCount === 0) {
    await Deployment.create({
      userId,
      name: 'welcome-app',
      framework: 'node',
      region: 'us-east-1',
      status: 'live',
      url: 'https://welcome-app.syntaxverse.app',
      cpu: 18,
      memory: 32,
      logs: ['Build complete', 'Deployment live', 'Edge cache warmed'],
    });
  }
}
