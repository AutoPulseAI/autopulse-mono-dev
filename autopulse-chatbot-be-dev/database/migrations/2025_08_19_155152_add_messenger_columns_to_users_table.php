<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Page-scoped identity (PSID is unique per Page+App)
            $table->string('messenger_page_id')->nullable()->index()->after('id');
            $table->string('messenger_psid')->nullable()->after('messenger_page_id');

            // One row per page+psid
            $table->unique(['messenger_page_id', 'messenger_psid'], 'users_page_psid_unique');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique('users_page_psid_unique');
            $table->dropColumn(['messenger_page_id', 'messenger_psid']);
        });
    }
};
