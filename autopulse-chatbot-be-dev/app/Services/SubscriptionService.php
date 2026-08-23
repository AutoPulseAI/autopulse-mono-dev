<?php
namespace App\Services;

use App\Models\Plan;
use Stripe\Coupon;
use Stripe\Stripe;
use Exception;

class SubscriptionService
{
    public function __construct()
    {
        $stripeSecret = env('STRIPE_SECRET');
        Stripe::setApiKey($stripeSecret);
    }

    public function getAvailablePlans()
    {
        return Plan::where('price','>',0)->get();
    }

    public function applyCoupon($couponCode)
    {
        try {
            $coupon = $this->findCouponByName($couponCode);
            return $coupon ? $coupon->valid : false;
        } catch (Exception $e) {
            // Log the exception for debugging
            \Log::error('Error applying coupon: ' . $e->getMessage());
            return false;
        }
    }

    public function getCouponDetails($couponCode)
    {
        try {
            $coupon = $this->findCouponByName($couponCode);
           
            if ($coupon) {
                return [
                    'ID'=>$coupon->id,
                    'valid' => $coupon->valid,
                    'amount_off' => $coupon->amount_off ?? 0,
                    'percent_off' => $coupon->percent_off ?? 0
                ];
            }

            return [
                'valid' => false,
                'amount_off' => 0,
                'percent_off' => 0
            ];
        } catch (Exception $e) {
            // Log the exception for debugging
            \Log::error('Error retrieving coupon details: ' . $e->getMessage());
            return [
                'valid' => false,
                'amount_off' => 0,
                'percent_off' => 0
            ];
        }
    }

    private function findCouponByName($couponName)
    {
        try {
            $coupons = Coupon::all(['limit' => 100]);
            foreach ($coupons->data as $coupon) {
                if (isset($coupon->name) && $coupon->name === $couponName) {
                    return $coupon;
                }
            }
        } catch (Exception $e) {
            // Log the exception for debugging
            \Log::error('Error finding coupon by name: ' . $e->getMessage());
        }
        return null;
    }
}
