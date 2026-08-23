<!DOCTYPE html>
<html>
<head>
    <title>New Request Demo</title>
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
    </style>
</head>
<body>
    <h1>New Submission Received</h1>
    <table>
        <tr>
            <th>Field</th>
            <th>Details</th>
        </tr>
        <tr>
            <td><strong>Phone Number:</strong></td>
            <td>{{ $data['phone'] }}</td>
        </tr>
        <tr>
            <td><strong>Dealership Name:</strong></td>
            <td>{{ $data['dealership_name'] }}</td>
        </tr>
        <tr>
            <td><strong>First Name:</strong></td>
            <td>{{ $data['first_name'] }}</td>
        </tr>
        <tr>
            <td><strong>Last Name:</strong></td>
            <td>{{ $data['last_name'] }}</td>
        </tr>
       
        <tr>
            <td><strong>Email:</strong></td>
            <td>{{ $data['email'] }}</td>
        </tr>
        <tr>
            <td><strong>Website:</strong></td>
            <td>{{ $data['website'] }}</td>
        </tr>
    </table>
</body>
</html>
