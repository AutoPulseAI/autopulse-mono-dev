<!DOCTYPE html>
<html>
<head>
    <title>Contact Us Notification</title>
    <style>
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 10px;
            border: 1px solid #ddd;
        }
        th {
            background-color: #f4f4f4;
        }
        .header {
            background-color: #f9f9f9;
        }
    </style>
</head>
<body>
    <h2>Contact Us</h2> 
    <p>You have received an email from: <strong>{{ $name }}</strong></p>

    <table>
        <tr class="header">
            <th>Field</th>
            <th>Details</th>
        </tr>
        <tr>
            <td><strong>Name:</strong></td>
            <td>{{ $name }}</td>
        </tr>
        <tr>
            <td><strong>Email:</strong></td>
            <td>{{ $email }}</td>
        </tr>
        <tr>
            <td><strong>Phone:</strong></td>
            <td>{{ $phone }}</td>
        </tr>
        <tr>
            <td><strong>Subject:</strong></td>
            <td>{{ $subject }}</td>
        </tr>
        <tr>
            <td><strong>Message:</strong></td>
            <td>{{ $msg }}</td>
        </tr>
    </table>

    <p>Thanks,</p>
</body>
</html>
