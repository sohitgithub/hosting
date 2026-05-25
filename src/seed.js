import { User, Ticket } from './models/index.js';
import { bootstrapUser } from './services/bootstrapUser.js';

export async function runSeed() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@syntaxverse.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';

  let admin = await User.findOne({ where: { email: adminEmail } });
  if (!admin) {
    admin = await User.create({
      name: 'Syntax Verse Admin',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      plan: 'enterprise',
    });
    console.log(`Admin created: ${adminEmail} / ${adminPassword}`);
  }

  await bootstrapUser(admin.id, 'enterprise');

  const demoEmail = 'demo@syntaxverse.com';
  let demo = await User.findOne({ where: { email: demoEmail } });
  if (!demo) {
    demo = await User.create({
      name: 'Demo Developer',
      email: demoEmail,
      password: 'Demo123!',
      role: 'user',
      plan: 'pro',
    });
    console.log(`Demo user: ${demoEmail} / Demo123!`);
  }
  await bootstrapUser(demo.id, 'pro');

  const ticketCount = await Ticket.count();
  if (ticketCount === 0 && demo) {
    await Ticket.create({
      userId: demo.id,
      subject: 'SSL certificate question',
      message: 'How do I enable auto SSL for my subdomain?',
      status: 'open',
      priority: 'medium',
    });
  }
}
