<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 Not Found</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            margin-top: 50px;
        }
        h1 {
            font-size: 3em;
            color: #333;
        }
        p {
            font-size: 1.2em;
            color: #666;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <h1>404 Not Found</h1>
    <p>Sorry, the page you are looking for could not be found.</p>
    <p><a href="{{ url('/') }}">Go to Homepage</a></p>
</body>
</html>
