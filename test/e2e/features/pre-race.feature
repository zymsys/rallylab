Feature: Pre-race registration

  Verify the pre-race registration flow: creating rallies, sections,
  and adding participants via the index.html UI.

  Scenario: Create a new rally
    Given I am on the login page
    When I sign in with email "tester@example.com"
    And I create a rally named "Spring Rally 2026" on "2026-04-01"
    Then I should see the heading "Spring Rally 2026"
    And I should see "2026-04-01"

  Scenario: Add sections to a rally
    Given I am on the login page
    When I sign in with email "tester@example.com"
    And I create a rally named "Spring Rally 2026" on "2026-04-01"
    And I add a section named "Beaver Buggies"
    And I add a section named "Kub Kars"
    Then I should see "Beaver Buggies"
    And I should see "Kub Kars"
    And I should see sections with 0 participants each

  Scenario: Add participant to a section
    Given I am on the login page
    When I load demo data and sign in
    And I click "Manage"
    And I click "Roster" for "Kub Kars"
    And I click "Edit" for "1st Newmarket"
    And I add a participant named "Zara McPherson"
    Then I should see "Zara McPherson" in the roster

  Scenario: Demo data loads complete structure
    Given I am on the login page
    When I load demo data and sign in
    Then I should see the heading "Your Rallies"
    And I should see "Kub Kars Rally 2026"
    When I click "Manage"
    Then I should see "Beaver Buggies"
    And I should see "Kub Kars"
    And I should see "Scout Trucks"
