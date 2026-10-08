import dbConnect from "@lib/mongodb";
import User from "@models/User";
import { loadSettingsEditor, SETTINGS_VIEW_ONLY_MESSAGE } from "@lib/apiAuth";

// Follow-up settings are edited by AutoPulse super admins only; dealers view them (client, 8 Oct 2026 meeting).

export async function PUT(req) {
    try {
        await dbConnect();
        const editor = await loadSettingsEditor(req);
        if (!editor.superAdmin) {
            return new Response(JSON.stringify({ message: SETTINGS_VIEW_ONLY_MESSAGE }), {
                status: editor.user ? 403 : 401,
                headers: { "Content-Type": "application/json" },
            });
        }
        const { dealerId, autoReplyEnabled, rules } = await req.json();

        if (!dealerId) {
            return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const dealer = await User.findById(dealerId);
        dealer.setting =  {};
        //await dealer.save();
        if (!dealer) {
            return new Response(JSON.stringify({ message: "Dealer not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }
        

        // Validate rules structure
        if (!Array.isArray(rules)) {
            return new Response(JSON.stringify({ message: "Rules must be an array" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }


        // Validate each rule
        for (const rule of rules) {
            
            if (rule.triggerType === 'status' && !rule.leadStatus) {
                return new Response(
                    JSON.stringify({ message: "Status-based rules require leadStatus" }),
                    { status: 400, headers: { "Content-Type": "application/json" } }
                );
            }
        }

       
        //dealer.setting = dealer.setting || {};
        dealer.setting.autoReplyEnabled = autoReplyEnabled;
        dealer.setting.rules = rules;
        //dealer.setting.noFollowRules = noFollowRules;
        //dealer.setting.lastUpdated = new Date();

        await dealer.save();

        return new Response(
            JSON.stringify({ 
                message: "Follow-up settings saved successfully",
                success: true,
                settings: dealer.setting
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );

    } catch (error) {
        console.error("Error updating follow-up settings:", error);
        return new Response(
            JSON.stringify({ message: "Error updating follow-up settings", error: error.message }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}

export async function GET(req) {
    try {
        await dbConnect();
        const url = new URL(req.url);
        const dealerId = url.searchParams.get('dealerId');

        if (!dealerId) {
            return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const dealer = await User.findById(dealerId);
        if (!dealer) {
            return new Response(JSON.stringify({ message: "Dealer not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Return default settings if none exist
        const settings = dealer.setting || {
            autoReplyEnabled: false,
            rules: [],
            noFollowRules: []
        };

        return new Response(
            JSON.stringify({ 
                success: true,
                settings 
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );

    } catch (error) {
        console.error("Error fetching follow-up settings:", error);
        return new Response(
            JSON.stringify({ message: "Error fetching follow-up settings", error: error.message }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}

export async function POST(req) {
    try {
        await dbConnect();
        const editor = await loadSettingsEditor(req);
        if (!editor.superAdmin) {
            return new Response(JSON.stringify({ message: SETTINGS_VIEW_ONLY_MESSAGE }), {
                status: editor.user ? 403 : 401,
                headers: { "Content-Type": "application/json" },
            });
        }
        const { dealerId } = await req.json();

        if (!dealerId) {
            return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const dealer = await User.findById(dealerId);
        if (!dealer) {
            return new Response(JSON.stringify({ message: "Dealer not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Check if settings exist
        const hasSettings = !!dealer.setting;

        return new Response(
            JSON.stringify({ 
                hasSettings,
                exists: hasSettings // For backward compatibility
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );

    } catch (error) {
        console.error("Error checking follow-up settings:", error);
        return new Response(
            JSON.stringify({ message: "Error checking follow-up settings", error: error.message }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}

export async function DELETE(req) {
    try {
        await dbConnect();
        const editor = await loadSettingsEditor(req);
        if (!editor.superAdmin) {
            return new Response(JSON.stringify({ message: SETTINGS_VIEW_ONLY_MESSAGE }), {
                status: editor.user ? 403 : 401,
                headers: { "Content-Type": "application/json" },
            });
        }
        const { dealerId } = await req.json();

        if (!dealerId) {
            return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const dealer = await User.findById(dealerId);
        if (!dealer) {
            return new Response(JSON.stringify({ message: "Dealer not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Check if settings exist before attempting to delete
        if (!dealer.setting) {
            return new Response(
                JSON.stringify({ 
                    message: "No follow-up settings exist for this dealer",
                    success: false
                }),
                {
                    status: 404,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        // Remove the entire settings object
        dealer.setting = undefined;
        await dealer.save();

        return new Response(
            JSON.stringify({ 
                message: "Follow-up settings deleted successfully",
                success: true
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );

    } catch (error) {
        console.error("Error deleting follow-up settings:", error);
        return new Response(
            JSON.stringify({ 
                message: "Error deleting follow-up settings", 
                error: error.message 
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}