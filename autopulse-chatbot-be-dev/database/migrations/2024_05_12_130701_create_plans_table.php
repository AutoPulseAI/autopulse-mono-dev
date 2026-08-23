<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up()
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->decimal('price', 10, 2); // Adjust precision and scale as needed
            $table->string('interval'); // 'day', 'week', 'month', 'year'
            $table->string('stripe_interval');
            $table->text('description')->nullable();
            $table->string('interval_count');
            $table->string('stripe_plan_id')->unique(); // Stripe Plan ID
            $table->string('stripe_price_id')->unique(); // Stripe Price ID
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('plans');
    }
};
