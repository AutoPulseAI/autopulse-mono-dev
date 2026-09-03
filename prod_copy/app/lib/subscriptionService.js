class SubscriptionService {
    // ... existing methods ...
  
    async upgradeSubscription({ userId, packageId, currentSubscriptionId }) {
      try {
        // 1. Validate the current subscription
        const currentSub = await this.prisma.subscription.findUnique({
          where: { id: currentSubscriptionId, userId }
        });
  
        if (!currentSub) {
          return { error: 'Current subscription not found', status: 404 };
        }
  
        // 2. Get the new package
        const newPackage = await this.prisma.package.findUnique({
          where: { id: packageId }
        });
  
        if (!newPackage) {
          return { error: 'Package not found', status: 404 };
        }
  
        // 3. Check if this is actually an upgrade (optional)
        if (newPackage.price <= currentSub.price) {
          return { error: 'Please select a higher-tier package for upgrade', status: 400 };
        }
  
        // 4. Handle Stripe integration if using Stripe
        if (currentSub.stripeSubscriptionId) {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          
          // Retrieve the current subscription
          const stripeSubscription = await stripe.subscriptions.retrieve(
            currentSub.stripeSubscriptionId
          );
  
          // Create upgrade subscription item
          const subscription = await stripe.subscriptions.update(
            currentSub.stripeSubscriptionId,
            {
              items: [{
                id: stripeSubscription.items.data[0].id,
                price: newPackage.stripePriceId, // Make sure your packages have stripePriceId
              }],
              proration_behavior: 'create_prorations', // or 'none' if you want to bill at next cycle
            }
          );
  
          // 5. Update our database
          const updatedSub = await this.prisma.subscription.update({
            where: { id: currentSubscriptionId },
            data: {
              packageId: newPackage.id,
              price: newPackage.price,
              features: newPackage.features,
              status: 'active',
              stripeSubscriptionId: subscription.id,
              currentPeriodEnd: new Date(subscription.current_period_end * 1000)
            }
          });
  
          return { 
            message: 'Subscription upgraded successfully',
            subscription: updatedSub,
            url: null // No redirect needed for Stripe upgrades
          };
        }
  
        // 6. Handle manual upgrades (non-Stripe)
        const updatedSub = await this.prisma.subscription.update({
          where: { id: currentSubscriptionId },
          data: {
            packageId: newPackage.id,
            price: newPackage.price,
            features: newPackage.features,
            status: 'active'
          }
        });
  
        return { 
          message: 'Subscription upgraded successfully',
          subscription: updatedSub
        };
  
      } catch (error) {
        console.error('Upgrade error:', error);
        return { 
          error: error.message || 'Failed to upgrade subscription',
          status: 500
        };
      }
    }
  }
  
  export default SubscriptionService;