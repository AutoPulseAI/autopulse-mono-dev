<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::connection('secondary_db')->table('conversations', function (Blueprint $table) {
            $table->string('chat_source', 50)
                  ->default('chat')
                  ->after('api_url'); // place where you like
        });

        // Backfill existing rows (so old NULLs become 'chat')
        DB::connection('secondary_db')
            ->table('conversations')
            ->whereNull('chat_source')
            ->update(['chat_source' => 'chat']);
    }

    public function down(): void
    {
        Schema::connection('secondary_db')->table('conversations', function (Blueprint $table) {
            $table->dropColumn('chat_source');
        });
    }
};
