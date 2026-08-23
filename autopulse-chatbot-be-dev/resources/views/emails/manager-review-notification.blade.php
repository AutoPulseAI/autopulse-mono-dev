<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Manager Review Required</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .content {
            background-color: #ffffff;
            padding: 20px;
            border: 1px solid #e9ecef;
            border-radius: 8px;
        }
        .highlight {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        .info-box {
            background-color: #f8f9fa;
            padding: 15px;
            border-left: 4px solid #007bff;
            margin: 15px 0;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e9ecef;
            font-size: 12px;
            color: #6c757d;
        }
        .btn {
            display: inline-block;
            padding: 10px 20px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>🔍 Manager Review Required</h2>
        <p>A customer conversation requires your attention and review.</p>
    </div>

    <div class="content">
        <div class="highlight">
            <h3>Customer Query:</h3>
            <p><strong>"{{ $userQuery }}"</strong></p>
        </div>

        <div class="info-box">
            <h4>Conversation Details:</h4>
            <ul>
                <li><strong>Dealership:</strong> {{ $dealerName }}</li>
                <li><strong>Chatbot ID:</strong> {{ $chatbotId }}</li>
                <li><strong>Conversation ID:</strong> {{ $conversationId }}</li>
                <li><strong>Timestamp:</strong> {{ $timestamp }}</li>
            </ul>
        </div>

        <div class="info-box">
            <h4>Action Required:</h4>
            <p>Please review this customer interaction and take appropriate action if needed. The conversation may require:</p>
            <ul>
                <li>Follow-up with the customer</li>
                <li>Escalation to sales team</li>
                <li>Additional information or clarification</li>
                <li>Manual intervention in the conversation</li>
            </ul>
        </div>

        <div style="text-align: center; margin: 20px 0;">
            <a href="{{ url('/conversation/' . $conversationId) }}" class="btn">View Full Conversation</a>
        </div>
    </div>

    <div class="footer">
        <p>This is an automated notification from your dealership's chatbot system.</p>
        <p>Please do not reply to this email. If you need assistance, contact your system administrator.</p>
    </div>
</body>
</html>
