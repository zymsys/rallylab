Feature: Smoke tests

  Verify the application loads and basic auth flows work.

  Scenario: Login page loads
    Given I am on the login page
    Then I should see the page title "RallyLab — Registration"
    And I should see "Pinewood Derby Race Management"

  Scenario: Email sign-in reaches event list
    Given I am on the login page
    When I sign in with email "tester@example.com"
    Then I should see the heading "Your Events"

  Scenario: Demo data sign-in populates events
    Given I am on the login page
    When I load demo data and sign in
    Then I should see the heading "Your Events"
    And I should see "Manage"

  Scenario: Navigate to event details
    Given I am on the login page
    When I load demo data and sign in
    And I click "Manage"
    Then I should see "Sections"

  Scenario: Operator page loads
    Given I am on the operator page
    Then I should see the page title "RallyLab — Operator"
