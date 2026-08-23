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
        Schema::create('transactions', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('dealer_id');
            $table->unsignedBigInteger('store_id');
            $table->string('subscription_id')->nullable();
            $table->decimal('total_amount', 8, 2);
            $table->decimal('discount_amount', 8, 2)->nullable();
            $table->decimal('coupon_amount', 8, 2)->nullable();
            $table->string('coupon_code')->nullable();
            $table->timestamps();

            $table->foreign('dealer_id')->references('id')->on('dealers')->onDelete('cascade');
            $table->foreign('store_id')->references('id')->on('dealer_source')->onDelete('cascade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('transactions');
    }
};
