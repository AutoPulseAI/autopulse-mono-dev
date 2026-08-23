<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('dealer_source', function (Blueprint $table) {
            $table->smallInteger('subscribed')->default(0);
            $table->smallInteger('is_manage_by_admin')->default(0);
            $table->float('subscription_price', 8, 2)->nullable();
            $table->string('subscription_plan')->nullable();
            $table->smallInteger('is_subscribed')->default(0);
            $table->date('cancelled_at')->nullable();
            $table->string('subscription_id')->nullable();
            $table->smallInteger('free_trial')->default(0);
            $table->date('free_trial_start_date')->nullable();
           
            $table->date('free_trial_end_date')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('dealer_source', function (Blueprint $table) {
            $table->dropColumn('is_manage_by_admin');
            $table->dropColumn('subscription_price');
            $table->dropColumn('subscription_plan');
            $table->dropColumn('subscription_id');
            $table->dropColumn('cancelled_at');
            $table->dropColumn('free_trial');
            $table->dropColumn('subscribed');
            $table->dropColumn('free_trial_end_date');
            $table->dropColumn('free_trial_start_date');
            
           
        });
    }
};
