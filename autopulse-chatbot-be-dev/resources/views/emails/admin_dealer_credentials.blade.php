<!-- resources/views/emails/dealer_verification.blade.php -->

<!DOCTYPE html>
<html>
<head>
    <title>Dealer Account Verification</title>
</head>
<body>
    <h1>Hello, {{ $dealer->name }} </h1>
    <p>Your dealer account has been created. Please use the following credentials to log in:</p>
    <p>Email: {{ $dealer->email }}</p>
    <p>Password: {{ $password }}</p>
    <p>Please change your password after logging in for the first time.</p>
</body>
</html>
